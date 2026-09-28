<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import {
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

interface Column {
  fieldname: string
  label: string
  fieldtype: string
  options?: string
}

interface Row {
  indent: number
  [fieldname: string]: unknown
}

interface AvailabilityResponse {
  columns: Column[]
  data: Row[]
  report_summary: { label: string; value: unknown }[]
}

const SO_STATUSES = [
  'Draft',
  'On Hold',
  'To Pay',
  'To Deliver and Bill',
  'To Bill',
  'To Deliver',
  'Completed',
  'Cancelled',
  'Closed',
]

const filters = reactive({
  sales_order: '',
  so_status: '',
  customer: '',
  item_code: '',
  warehouse: '',
  from_date: '',
  to_date: '',
  today: false,
  group_by_item: false,
})
const level = ref<'' | '0' | '1'>('')

const report = useCall<AvailabilityResponse, { filters: string }>({
  url: '/api/v2/method/dms.api.reports.get_sales_availability',
  params: () => ({ filters: JSON.stringify(filters) }),
  refetch: true,
})

const numericTypes = new Set(['Float', 'Currency', 'Int'])
const columns = computed(() => report.data?.columns ?? [])
const rows = computed(() => {
  const data = report.data?.data ?? []
  return level.value === '' ? data : data.filter((row) => String(row.indent) === level.value)
})

const exportUrl = computed(
  () =>
    `/api/method/dms.api.reports.export_sales_availability?filters=${encodeURIComponent(
      JSON.stringify({ ...filters, level: level.value }),
    )}`,
)
</script>

<template>
  <PageHeader>
    <PageHeaderTitle title="Sales Availability Report" />
  </PageHeader>

  <div class="w-full space-y-4 px-3 pb-10 pt-6 sm:px-5">
    <div class="flex flex-wrap items-end gap-3">
      <TextInput v-model="filters.sales_order" label="Sales Order" class="w-40" />
      <Select
        v-model="filters.so_status"
        label="Status"
        :options="['', ...SO_STATUSES]"
        class="w-40"
      />
      <TextInput v-model="filters.customer" label="Customer" class="w-40" />
      <TextInput v-model="filters.item_code" label="Item Code" class="w-36" />
      <TextInput v-model="filters.warehouse" label="Warehouse" class="w-36" />
      <DatePicker v-model="filters.from_date" label="From Date" class="w-36" />
      <DatePicker v-model="filters.to_date" label="To Date" class="w-36" />
      <Select
        v-model="level"
        label="Level"
        :options="[
          { label: 'All Levels', value: '' },
          { label: 'Top Level', value: '0' },
          { label: 'Detail Level', value: '1' },
        ]"
        class="w-36"
      />
      <Checkbox v-model="filters.today" label="Today" />
      <Checkbox v-model="filters.group_by_item" label="Group by Item" />
      <Button label="Export" icon-left="lucide-download" :href="exportUrl" />
    </div>

    <LoadingIndicator v-if="report.loading" class="mx-auto size-6 text-ink-gray-5" />
    <ErrorMessage v-else-if="report.error" :message="report.error" />
    <div
      v-else-if="!rows.length"
      class="flex flex-col items-center justify-center gap-3 py-16 text-center"
    >
      <span class="lucide-package-search size-6 text-ink-gray-5" aria-hidden="true" />
      <p class="text-sm text-ink-gray-5">No availability data for these filters.</p>
    </div>
    <div v-else class="overflow-x-auto rounded-6 border border-outline-gray-1">
      <table class="w-full text-left text-sm">
        <thead>
          <tr class="border-b border-outline-gray-1 text-ink-gray-6">
            <th class="px-4 py-2 font-medium">#</th>
            <th
              v-for="col in columns"
              :key="col.fieldname"
              class="px-4 py-2 font-medium"
              :class="numericTypes.has(col.fieldtype) ? 'text-right' : 'text-left'"
            >
              {{ col.label }}
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-outline-gray-1">
          <tr v-for="(row, i) in rows" :key="i">
            <td class="px-4 py-2 text-ink-gray-7">{{ i + 1 }}</td>
            <td
              v-for="(col, j) in columns"
              :key="col.fieldname"
              class="px-4 py-2"
              :class="[
                numericTypes.has(col.fieldtype) ? 'text-right text-ink-gray-7' : 'text-ink-gray-8',
                j === 0 && row.indent ? 'pl-8' : '',
                row.indent === 0 ? 'font-medium' : '',
              ]"
            >
              <a
                v-if="col.fieldtype === 'Link' && col.options && row[col.fieldname]"
                :href="deskLink(col.options, String(row[col.fieldname]))"
                target="_blank"
                class="text-ink-blue-link hover:underline"
              >
                {{ row[col.fieldname] }}
              </a>
              <template v-else>{{ row[col.fieldname] ?? '' }}</template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
