<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useTorrentsStore } from './stores/torrents'
import LoginForm from './components/LoginForm.vue'
import TorrentList from './components/TorrentList.vue'
import AddTorrentModal from './components/AddTorrentModal.vue'
import Navbar from './components/Navbar.vue'
import ToastNotification from './components/ToastNotification.vue'

const store = useTorrentsStore()
const showAddModal = ref(false)
let pollInterval: number | null = null

onMounted(async () => {
  await store.checkAuth()
  if (store.isAuthenticated) {
    startPolling()
  }
})

onUnmounted(() => {
  stopPolling()
})

function startPolling() {
  pollInterval = window.setInterval(() => {
    store.fetchTorrents(false)  // Don't show loading state during polling
  }, 2000)
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
}

async function handleLogin() {
  if (store.isAuthenticated) {
    startPolling()
  }
}

async function handleLogout() {
  stopPolling()
  await store.logout()
}
</script>

<template>
  <div class="min-h-screen bg-gray-100">
    <!-- Connection lost banner -->
    <Transition name="banner">
      <div
        v-if="store.connectionLost && store.isAuthenticated"
        class="bg-yellow-400 text-yellow-900 text-sm text-center py-2 px-4 font-medium"
      >
        Connection lost — reconnecting...
      </div>
    </Transition>

    <template v-if="!store.isAuthenticated">
      <div class="flex items-center justify-center min-h-screen">
        <LoginForm @login="handleLogin" />
      </div>
    </template>
    <template v-else>
      <Navbar @logout="handleLogout" @add="showAddModal = true" />
      <main class="container mx-auto px-4 py-6">
        <TorrentList />
      </main>
      <AddTorrentModal v-if="showAddModal" @close="showAddModal = false" />
    </template>

    <ToastNotification />
  </div>
</template>

<style scoped>
.banner-enter-active,
.banner-leave-active {
  transition: all 0.3s ease;
}
.banner-enter-from,
.banner-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}
</style>
