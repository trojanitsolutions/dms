<script setup lang="ts">
import { Sidebar, SidebarHeader, SidebarItem, useColorScheme } from 'frappe-ui'

const { resolvedColorScheme, toggleColorScheme } = useColorScheme()
</script>

<template>
  <Sidebar :collapsible="false">
    <SidebarHeader title="DMS" :show-logo="false" />
    <div class="flex-1 overflow-y-auto">
      <SidebarItem
        label="Back to System"
        icon="lucide-arrow-left"
        href="/desk"
      />
      <SidebarItem
        label="Employee Checkin Record"
        icon="lucide-user-check"
        route="/employee-checkin"
      />
      <SidebarItem
        label="Sales Order Overview"
        icon="lucide-package-search"
        route="/sales-availability"
      />
    </div>
    <button
      class="mx-2 mb-2 flex items-center gap-2 rounded px-2 py-1.5 text-sm text-ink-gray-6 hover:bg-surface-gray-2"
      @click="toggleColorScheme()"
    >
      <span
        :class="resolvedColorScheme === 'dark' ? 'lucide-sun' : 'lucide-moon'"
        class="size-4"
        aria-hidden="true"
      />
      {{ resolvedColorScheme === 'dark' ? 'Light Mode' : 'Dark Mode' }}
    </button>
  </Sidebar>
</template>
