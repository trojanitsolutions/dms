<script setup lang="ts">
import { computed, reactive } from 'vue'
import {
  Badge,
  Button,
  Checkbox,
  DatePicker,
  ErrorMessage,
  LoadingIndicator,
  PageHeader,
  PageHeaderTitle,
  Select,
  TextInput,
  useCall,
} from 'frappe-ui'
import { deskLink } from '../utils'

interface CheckinRow {
  name: string
  employee: string
  employee_name: string
  log_type: 'IN' | 'OUT' | ''
  time: string
  shift: string
  employee_image: string | null
}

const filters = reactive({
  employee: '',
  log_type: '',
  from_date: '',
  to_date: '',
  today: false,
})

const checkins = useCall<CheckinRow[], { filters: string }>({
  url: '/api/v2/method/dms.api.reports.get_employee_checkins',
  params: () => ({ filters: JSON.stringify(filters) }),
  refetch: true,
})
const rows = computed(() => checkins.data ?? [])

const exportUrl = computed(
  () =>
    `/api/method/dms.api.reports.export_employee_checkins?filters=${encodeURIComponent(
      JSON.stringify(filters),
    )}`,
)
</script>

<template>
  <PageHeader>
    <PageHeaderTitle title="Employee Checkin Report" />
  </PageHeader>

  <div class="w-full space-y-4 px-3 pb-10 pt-6 sm:px-5">
    <div class="flex flex-wrap items-end gap-3">
      <TextInput
        v-model="filters.employee"
        label="Employee"
        placeholder="Employee ID"
        class="w-44"
      />
      <Select
        v-model="filters.log_type"
        label="Log Type"
        :options="[
          { label: 'All', value: '' },
          { label: 'IN', value: 'IN' },
          { label: 'OUT', value: 'OUT' },
        ]"
        class="w-32"
      />
      <DatePicker v-model="filters.from_date" label="From Date" class="w-40" />
      <DatePicker v-model="filters.to_date" label="To Date" class="w-40" />
      <Checkbox v-model="filters.today" label="Today" />
      <Button label="Export" icon-left="lucide-download" :href="exportUrl" />
    </div>

    <LoadingIndicator v-if="checkins.loading" class="mx-auto size-6 text-ink-gray-5" />
    <ErrorMessage v-else-if="checkins.error" :message="checkins.error" />
    <div
      v-else-if="!rows.length"
      class="flex flex-col items-center justify-center gap-3 py-16 text-center"
    >
      <span class="lucide-user-x size-6 text-ink-gray-5" aria-hidden="true" />
      <p class="text-sm text-ink-gray-5">No checkins found for these filters.</p>
    </div>
    <div v-else class="overflow-x-auto rounded-6 border border-outline-gray-1">
      <table class="w-full text-left text-sm">
        <thead>
          <tr class="border-b border-outline-gray-1 text-ink-gray-6">
            <th class="px-4 py-2 font-medium">#</th>
            <th class="px-4 py-2 font-medium">Checkin ID</th>
            <th class="px-4 py-2 font-medium">Employee</th>
            <th class="px-4 py-2 font-medium">Log Type</th>
            <th class="px-4 py-2 font-medium">Time</th>
            <th class="px-4 py-2 font-medium">Shift</th>
            <th class="px-4 py-2 font-medium">Photo</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-outline-gray-1">
          <tr v-for="(row, i) in rows" :key="row.name">
            <td class="px-4 py-2 text-ink-gray-7">{{ i + 1 }}</td>
            <td class="px-4 py-2 text-ink-gray-7">
              <a
                :href="deskLink('Employee Checkin', row.name)"
                target="_blank"
                class="text-ink-blue-link hover:underline"
              >
                {{ row.name }}
              </a>
            </td>
            <td class="px-4 py-2 text-ink-gray-8">
              {{ row.employee_name }}
              <span class="text-ink-gray-5">({{ row.employee }})</span>
            </td>
            <td class="px-4 py-2">
              <Badge
                v-if="row.log_type"
                :theme="row.log_type === 'IN' ? 'green' : 'red'"
                :label="row.log_type"
              />
            </td>
            <td class="px-4 py-2 text-ink-gray-7">{{ row.time }}</td>
            <td class="px-4 py-2 text-ink-gray-7">{{ row.shift }}</td>
            <td class="px-4 py-2">
              <img
                v-if="row.employee_image"
                :src="row.employee_image"
                alt="Checkin photo"
                class="size-10 rounded object-cover"
              />
              <div
                v-else
                class="flex size-10 items-center justify-center rounded bg-surface-gray-2 text-ink-gray-4"
              >
                <span class="lucide-image-off size-4" aria-hidden="true" />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
