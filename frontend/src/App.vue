<script setup lang="ts">
import { DesktopShell, FrappeUIProvider, useColorScheme } from 'frappe-ui'
import AppSidebar from './components/AppSidebar.vue'

useColorScheme()
</script>

<template>
  <FrappeUIProvider>
    <div class="h-screen bg-surface-base text-ink-gray-8">
      <DesktopShell>
        <template #sidebar>
          <AppSidebar />
        </template>
        <RouterView />
      </DesktopShell>
    </div>
  </FrappeUIProvider>
</template>
