import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// Supported archive extensions
const ARCHIVE_EXTENSIONS = [
  '.zip',
  '.rar',
  '.7z',
  '.tar',
  '.tar.gz',
  '.tgz',
  '.tar.bz2',
  '.tbz2',
  '.tar.xz',
  '.txz',
];

// Extraction queue to prevent concurrent extractions
// Only one extraction at a time to avoid race conditions
let extractionInProgress = false;
const extractionQueue: Array<{
  resolve: (value: string[]) => void;
  reject: (error: Error) => void;
  archivePath: string;
  destDir: string;
  originalFilename?: string;
}> = [];

/**
 * Process the next extraction in the queue
 */
async function processExtractionQueue(): Promise<void> {
  if (extractionInProgress || extractionQueue.length === 0) {
    return;
  }

  extractionInProgress = true;
  const next = extractionQueue.shift()!;

  try {
    console.log(`[Extractor] Starting extraction (${extractionQueue.length} in queue): ${next.archivePath}`);
    const result = await doExtractArchive(next.archivePath, next.destDir, next.originalFilename);
    next.resolve(result);
  } catch (error: any) {
    next.reject(error);
  } finally {
    extractionInProgress = false;
    // Process next in queue
    processExtractionQueue();
  }
}

/**
 * Check if a file is an archive based on its extension
 */
export function isArchive(filename: string): boolean {
  const lowerFilename = filename.toLowerCase();
  return ARCHIVE_EXTENSIONS.some(ext => lowerFilename.endsWith(ext));
}

/**
 * Get the archive type from filename
 */
function getArchiveType(filename: string): 'zip' | 'rar' | '7z' | 'tar' | null {
  const lowerFilename = filename.toLowerCase();

  if (lowerFilename.endsWith('.zip')) return 'zip';
  if (lowerFilename.endsWith('.rar')) return 'rar';
  if (lowerFilename.endsWith('.7z')) return '7z';
  if (
    lowerFilename.endsWith('.tar') ||
    lowerFilename.endsWith('.tar.gz') ||
    lowerFilename.endsWith('.tgz') ||
    lowerFilename.endsWith('.tar.bz2') ||
    lowerFilename.endsWith('.tbz2') ||
    lowerFilename.endsWith('.tar.xz') ||
    lowerFilename.endsWith('.txz')
  ) {
    return 'tar';
  }

  return null;
}

/**
 * Execute a command and return a promise
 */
function execCommand(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { 
      cwd,
      env: env ? { ...process.env, ...env } : process.env
    });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr || stdout}`));
      }
    });

    proc.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Get archive basename without extension
 */
function getArchiveBasename(archivePath: string): string {
  let basename = path.basename(archivePath);
  
  // Remove known extensions (handle multi-part like .tar.gz)
  const multiPartExtensions = ['.tar.gz', '.tar.bz2', '.tar.xz', '.tgz', '.tbz2', '.txz'];
  for (const ext of multiPartExtensions) {
    if (basename.toLowerCase().endsWith(ext)) {
      return basename.slice(0, -ext.length);
    }
  }
  
  // Remove single extension
  const singleExtensions = ['.zip', '.rar', '.7z', '.tar'];
  for (const ext of singleExtensions) {
    if (basename.toLowerCase().endsWith(ext)) {
      return basename.slice(0, -ext.length);
    }
  }
  
  return basename;
}

/**
 * Get all paths from an archive and determine if there's a single root folder
 * Returns { rootFolder, paths } where rootFolder is null if files are at root
 */
async function analyzeArchiveStructure(archivePath: string, archiveType: string): Promise<{ rootFolder: string | null; paths: string[] }> {
  try {
    let output: { stdout: string; stderr: string };
    
    switch (archiveType) {
      case 'zip':
      case '7z':
        // Use 7z l (list) to get archive contents
        output = await execCommand('7z', ['l', '-slt', archivePath], path.dirname(archivePath));
        break;
      case 'rar':
        // Use bsdtar to list
        output = await execCommand('bsdtar', ['-tf', archivePath], path.dirname(archivePath));
        break;
      case 'tar':
        output = await execCommand('tar', ['-tf', archivePath], path.dirname(archivePath));
        break;
      default:
        return { rootFolder: null, paths: [] };
    }

    // Parse the output to find all paths
    const paths: string[] = [];
    
    if (archiveType === 'zip' || archiveType === '7z') {
      // 7z -slt output format: Path = filename
      const lines = output.stdout.split('\n');
      for (const line of lines) {
        if (line.startsWith('Path = ')) {
          const filePath = line.substring(7).trim();
          if (filePath && filePath !== archivePath) {
            paths.push(filePath);
          }
        }
      }
    } else {
      // tar/bsdtar outputs file paths directly
      paths.push(...output.stdout.split('\n').filter(p => p.trim()));
    }

    if (paths.length === 0) {
      return { rootFolder: null, paths: [] };
    }

    // Get all top-level items (first part of each path)
    const topLevelItems = new Set<string>();
    for (const p of paths) {
      // Normalize path separators and get first component
      const normalized = p.replace(/\\/g, '/');
      const firstPart = normalized.split('/')[0];
      if (firstPart) {
        topLevelItems.add(firstPart);
      }
    }

    // If there's exactly one top-level item and it's a directory (paths have it as prefix)
    if (topLevelItems.size === 1) {
      const singleItem = Array.from(topLevelItems)[0];
      // Check if all paths start with this item followed by /
      const allUnderFolder = paths.every(p => {
        const normalized = p.replace(/\\/g, '/');
        return normalized === singleItem || normalized.startsWith(singleItem + '/');
      });
      
      if (allUnderFolder) {
        console.log(`[Extractor] Archive has root folder: ${singleItem}`);
        return { rootFolder: singleItem, paths };
      }
    }

    console.log(`[Extractor] Archive has ${topLevelItems.size} items at root level`);
    return { rootFolder: null, paths };
  } catch (error: any) {
    console.warn(`[Extractor] Could not analyze archive structure: ${error.message}`);
    return { rootFolder: null, paths: [] };
  }
}

/**
 * Pre-create all directories that will be needed during extraction
 */
function preCreateDirectories(paths: string[], baseDir: string): void {
  const directories = new Set<string>();
  
  for (const p of paths) {
    const normalized = p.replace(/\\/g, '/');
    const parts = normalized.split('/');
    
    // Build up directory paths (exclude the filename itself)
    let currentPath = baseDir;
    for (let i = 0; i < parts.length - 1; i++) {
      currentPath = path.join(currentPath, parts[i]);
      directories.add(currentPath);
    }
    
    // Also add the path itself if it ends with / (it's a directory)
    if (normalized.endsWith('/')) {
      directories.add(path.join(baseDir, normalized));
    }
  }
  
  // Sort directories by depth (shortest first) to create parents before children
  const sortedDirs = Array.from(directories).sort((a, b) => a.length - b.length);
  
  console.log(`[Extractor] Pre-creating ${sortedDirs.length} directories`);
  
  for (const dir of sortedDirs) {
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (err: any) {
        // Ignore if already exists (race condition with recursive: true)
        if (err.code !== 'EEXIST') {
          console.warn(`[Extractor] Failed to create directory ${dir}: ${err.message}`);
        }
      }
    }
  }
}

/**
 * Extract an archive to the destination directory (queued)
 * Uses a queue to prevent concurrent extractions
 */
export async function extractArchive(archivePath: string, destDir: string, originalFilename?: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    extractionQueue.push({
      resolve,
      reject,
      archivePath,
      destDir,
      originalFilename,
    });
    console.log(`[Extractor] Queued extraction (queue size: ${extractionQueue.length}): ${archivePath}`);
    processExtractionQueue();
  });
}

/**
 * Internal function to extract an archive
 * Intelligently handles folder creation:
 * - If archive has a root folder, extracts directly
 * - If files are at root, creates a subfolder based on archive name
 * @param archivePath Path to the archive file
 * @param destDir Destination directory
 * @param originalFilename Optional original filename (without hash prefix from temp files)
 * Returns the list of extracted files
 */
async function doExtractArchive(archivePath: string, destDir: string, originalFilename?: string): Promise<string[]> {
  const archiveType = getArchiveType(archivePath);

  if (!archiveType) {
    throw new Error(`Unsupported archive type: ${archivePath}`);
  }

  console.log(`[Extractor] Extracting ${archiveType} archive: ${archivePath}`);

  // Analyze archive structure to get root folder and all paths
  const { rootFolder } = await analyzeArchiveStructure(archivePath, archiveType);
  
  // Determine the final folder name
  let finalFolderName: string;
  if (rootFolder) {
    finalFolderName = rootFolder;
    console.log(`[Extractor] Archive contains root folder: ${rootFolder}`);
  } else {
    // No root folder, create one based on original filename or archive name
    const filenameToUse = originalFilename || path.basename(archivePath);
    finalFolderName = getArchiveBasename(filenameToUse);
    console.log(`[Extractor] No root folder in archive, will create: ${finalFolderName}`);
  }

  // Extract to a LOCAL temp directory first (same location as the archive)
  // This avoids issues with rclone mounts having latency/cache problems
  const tempExtractDir = path.join(path.dirname(archivePath), `extract_${Date.now()}`);
  console.log(`[Extractor] Extracting to local temp: ${tempExtractDir}`);

  // Create temp extraction directory
  if (!fs.existsSync(tempExtractDir)) {
    fs.mkdirSync(tempExtractDir, { recursive: true });
  }

  try {
    switch (archiveType) {
      case 'zip':
        // Use 7z for ZIP files - more robust than unzip for problematic archives
        // -mmt=off disables multi-threading to avoid race conditions when creating files
        await execCommand('7z', ['x', `-o${tempExtractDir}`, '-y', '-mmt=off', '-bso0', '-bsp0', archivePath], tempExtractDir);
        break;

      case 'rar':
        // Use bsdtar from libarchive-tools (unrar is not available in Alpine)
        await execCommand('bsdtar', ['-xf', archivePath, '-C', tempExtractDir], tempExtractDir);
        break;

      case '7z':
        // -mmt=off disables multi-threading to avoid race conditions when creating files
        await execCommand('7z', ['x', `-o${tempExtractDir}`, '-y', '-mmt=off', archivePath], tempExtractDir);
        break;

      case 'tar':
        await execCommand('tar', ['-xf', archivePath, '-C', tempExtractDir], tempExtractDir);
        break;
    }

    console.log(`[Extractor] Local extraction complete: ${tempExtractDir}`);

    // Now move extracted files to the final destination (rclone mount or local)
    // This handles the case where rclone has latency issues
    const extractedItems = fs.readdirSync(tempExtractDir);
    
    // Determine final destination:
    // - If archive had root folder: move directly to destDir (folder structure preserved in archive)
    // - If archive had no root folder: create subfolder based on archive name
    let finalDestDir = destDir;
    if (!rootFolder) {
      // No root folder in archive, need to create one
      finalDestDir = path.join(destDir, finalFolderName);
      console.log(`[Extractor] Creating destination folder: ${finalDestDir}`);
    }
    
    console.log(`[Extractor] Moving ${extractedItems.length} items to: ${finalDestDir}`);

    // Ensure final destination exists
    if (!fs.existsSync(finalDestDir)) {
      fs.mkdirSync(finalDestDir, { recursive: true });
    }

    // Move items to final destination
    const finalPaths: string[] = [];
    for (const item of extractedItems) {
      const srcPath = path.join(tempExtractDir, item);
      const destPath = path.join(finalDestDir, item);
      
      console.log(`[Extractor] Moving: ${item}`);
      
      try {
        // Try rename first (same filesystem)
        fs.renameSync(srcPath, destPath);
      } catch (renameErr: any) {
        if (renameErr.code === 'EXDEV') {
          // Cross-device move, need to copy then delete
          console.log(`[Extractor] Cross-device move for: ${item}, using copy`);
          await copyRecursive(srcPath, destPath);
          await deleteRecursive(srcPath);
        } else {
          throw renameErr;
        }
      }
      
      finalPaths.push(destPath);
    }

    // Clean up temp extraction directory
    try {
      fs.rmdirSync(tempExtractDir);
      console.log(`[Extractor] Cleaned up temp directory: ${tempExtractDir}`);
    } catch (cleanupErr) {
      console.warn(`[Extractor] Could not clean up temp directory: ${tempExtractDir}`);
    }

    console.log(`[Extractor] Extraction and move complete: ${finalPaths.length} items`);
    return finalPaths;
  } catch (error: any) {
    // Clean up temp directory on error
    try {
      if (fs.existsSync(tempExtractDir)) {
        await deleteRecursive(tempExtractDir);
      }
    } catch {}
    
    console.error(`[Extractor] Extraction failed: ${error.message}`);
    throw new Error(`Extraction failed: ${error.message}`);
  }
}

/**
 * Recursively copy a file or directory
 */
async function copyRecursive(src: string, dest: string): Promise<void> {
  const stat = fs.statSync(src);
  
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    const items = fs.readdirSync(src);
    for (const item of items) {
      await copyRecursive(path.join(src, item), path.join(dest, item));
    }
  } else {
    // Copy file
    fs.copyFileSync(src, dest);
  }
}

/**
 * Recursively delete a file or directory
 */
async function deleteRecursive(target: string): Promise<void> {
  const stat = fs.statSync(target);
  
  if (stat.isDirectory()) {
    const items = fs.readdirSync(target);
    for (const item of items) {
      await deleteRecursive(path.join(target, item));
    }
    fs.rmdirSync(target);
  } else {
    fs.unlinkSync(target);
  }
}

/**
 * Delete a file (used to remove archive after extraction)
 */
export async function deleteFile(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.unlink(filePath, (err) => {
      if (err) {
        console.error(`[Extractor] Failed to delete file: ${filePath} - ${err.message}`);
        reject(err);
      } else {
        console.log(`[Extractor] Deleted archive: ${filePath}`);
        resolve();
      }
    });
  });
}
