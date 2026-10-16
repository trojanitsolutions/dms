<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  Button,
  Checkbox,
  Combobox,
  DatePicker,
  ErrorMessage,
  LoadingIndicator,
  PageHeader,
  PageHeaderTitle,
  TextInput,
  debounce,
  useCall,
} from 'frappe-ui'
import { deskLink } from '../utils'

interface Column {
  fieldname: string
  label: string
  fieldtype: string
  options?: string
  hidden?: number
}

interface Row {
  [fieldname: string]: unknown
}

interface SummaryCard {
  key?: string
  label: string
  value: number
  datatype: string
  currency?: string
}

interface CustomerOption {
  value: string
  label: string
  description: string
}

interface BalanceResponse {
  columns: Column[]
  data: Row[]
  report_summary: SummaryCard[]
}

const PAGE_SIZES = [20, 100, 500, 2500]

const filters = reactive({
  company: '',
  as_on_date: '',
  customer: '',
  customer_group: '',
  show_zero_balance: false,
  // Empty means all rows.
  page_length: PAGE_SIZES[0] as number | null,
})
const step = ref(PAGE_SIZES[0])
// Selected customer IDs. Export downloads only these when any are selected.
const selected = ref<string[]>([])

const report = useCall<BalanceResponse, { filters: string }>({
  url: '/api/v2/method/dms.api.reports.get_customer_balance',
  params: () => ({ filters: JSON.stringify(filters) }),
  refetch: true,
})

// Customer picker: the typed text searches customers, the picked customer ID filters the report.
const customerQuery = ref('')
const customerSearch = ref('')
const selectedCustomer = ref<CustomerOption | null>(null)
watch(
  customerQuery,
  debounce((txt: string) => (customerSearch.value = txt), 300),
)

const customers = useCall<CustomerOption[], { txt: string }>({
  url: '/api/v2/method/dms.api.reports.search_customers',
  params: () => ({ txt: customerSearch.value }),
  refetch: true,
})

// Keep the picked customer in the list so the box still shows its name after the results change.
const customerOptions = computed(() => {
  const results = customers.data ?? []
  const picked = selectedCustomer.value
  return picked && !results.some((c) => c.value === picked.value) ? [picked, ...results] : results
})

function onCustomerPickerOpen(open: boolean) {
  if (open) customerQuery.value = ''
}

function clearCustomer() {
  filters.customer = ''
  selectedCustomer.value = null
  customerQuery.value = ''
}

const numericTypes = new Set(['Float', 'Currency', 'Int'])
const columns = computed(() => (report.data?.columns ?? []).filter((col) => !col.hidden))
const rows = computed(() => report.data?.data ?? [])
const summary = computed(() => report.data?.report_summary ?? [])
const total = computed(
  () => summary.value.find((card) => card.key === 'total_customers')?.value ?? rows.value.length,
)

const allSelected = computed(
  () => rows.value.length > 0 && rows.value.every((row) => isSelected(row)),
)
const someSelected = computed(() => !allSelected.value && rows.value.some((row) => isSelected(row)))

function isSelected(row: Row) {
  return selected.value.includes(String(row.customer))
}

function toggleRow(row: Row, checked: boolean | 1 | 0 | undefined) {
  const customer = String(row.customer)
  selected.value = checked
    ? [...selected.value, customer]
    : selected.value.filter((name) => name !== customer)
}

function toggleAll(checked: boolean | 1 | 0 | undefined) {
  selected.value = checked ? rows.value.map((row) => String(row.customer)) : []
}

// Shows the currency code before the amount, e.g. "QAR 1,250.00".
const formatCurrency = (value: unknown, currency?: unknown) => {
  const amount = Number(value ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return currency ? `${currency} ${amount}` : amount
}

function setPageSize(size: number) {
  if (size) step.value = size
  filters.page_length = size || null
}

function loadMore() {
  filters.page_length = rows.value.length + step.value
}

const exportUrl = computed(
  () =>
    `/api/method/dms.api.reports.export_customer_balance?filters=${encodeURIComponent(
      JSON.stringify({ ...filters, selected: selected.value }),
    )}`,
)
</script>

<template>
  <PageHeader>
    <PageHeaderTitle title="Customer Balance Report" />
  </PageHeader>

  <div class="w-full space-y-4 px-3 pb-10 pt-6 sm:px-5">
    <div class="flex flex-wrap items-end gap-3">
      <TextInput v-model="filters.company" label="Company" :debounce="300" class="w-40" />
      <DatePicker v-model="filters.as_on_date" label="As On Date" class="w-36" />
      <div class="flex items-end gap-1">
        <Combobox
          v-model="filters.customer"
          v-model:query="customerQuery"
          label="Customer"
          placeholder="Search customer name or ID"
          :options="customerOptions"
          :loading="customers.loading"
          :filterable="false"
          open-on-focus
          class="w-56"
          @update:open="onCustomerPickerOpen"
          @update:selected-option="(option) => (selectedCustomer = option as CustomerOption | null)"
        />
        <Button
          v-if="filters.customer"
          icon="lucide-x"
          variant="ghost"
          aria-label="Clear customer"
          @click="clearCustomer"
        />
      </div>
      <TextInput
        v-model="filters.customer_group"
        label="Customer Group"
        :debounce="300"
        class="w-40"
      />
      <Checkbox v-model="filters.show_zero_balance" label="Show Zero Balance" />
      <Button
        :label="selected.length ? `Export Selected (${selected.length})` : 'Export'"
        icon-left="lucide-download"
        :href="exportUrl"
      />
      <Button v-if="selected.length" label="Clear Selection" @click="selected = []" />
    </div>

    <div v-if="summary.length" class="flex flex-wrap gap-3">
      <div
        v-for="card in summary"
        :key="card.label"
        class="min-w-48 rounded-6 border border-outline-gray-1 px-4 py-3"
      >
        <p class="text-sm text-ink-gray-5">{{ card.label }}</p>
        <p class="mt-1 text-lg font-semibold text-ink-gray-8">
          {{ card.datatype === 'Currency' ? formatCurrency(card.value, card.currency) : card.value }}
        </p>
      </div>
    </div>

    <LoadingIndicator v-if="report.loading" class="mx-auto size-6 text-ink-gray-5" />
    <ErrorMessage v-else-if="report.error" :message="report.error" />
    <div
      v-else-if="!rows.length"
      class="flex flex-col items-center justify-center gap-3 py-16 text-center"
    >
      <span class="lucide-wallet size-6 text-ink-gray-5" aria-hidden="true" />
      <p class="text-sm text-ink-gray-5">No customer balances for these filters.</p>
    </div>
    <template v-else>
      <div class="overflow-x-auto rounded-6 border border-outline-gray-1">
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="border-b border-outline-gray-1 text-ink-gray-6">
              <th class="w-10 px-4 py-2">
                <Checkbox
                  :model-value="allSelected"
                  :indeterminate="someSelected"
                  aria-label="Select all rows"
                  @update:model-value="toggleAll"
                />
              </th>
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
            <tr
              v-for="(row, i) in rows"
              :key="i"
              :class="isSelected(row) ? 'bg-surface-gray-2' : ''"
            >
              <td class="w-10 px-4 py-2">
                <Checkbox
                  :model-value="isSelected(row)"
                  :aria-label="`Select ${row.customer}`"
                  @update:model-value="(checked) => toggleRow(row, checked)"
                />
              </td>
              <td
                v-for="col in columns"
                :key="col.fieldname"
                class="px-4 py-2"
                :class="
                  numericTypes.has(col.fieldtype) ? 'text-right text-ink-gray-7' : 'text-ink-gray-8'
                "
              >
                <a
                  v-if="col.fieldtype === 'Link' && col.options && row[col.fieldname]"
                  :href="deskLink(col.options, String(row[col.fieldname]))"
                  target="_blank"
                  class="text-ink-blue-link hover:underline"
                >
                  {{ row[col.fieldname] }}
                </a>
                <template v-else-if="col.fieldtype === 'Currency'">
                  {{ formatCurrency(row[col.fieldname], row.currency) }}
                </template>
                <template v-else>{{ row[col.fieldname] ?? '' }}</template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex gap-1">
          <Button
            v-for="size in PAGE_SIZES"
            :key="size"
            :label="String(size)"
            size="sm"
            :variant="filters.page_length && size === step ? 'solid' : 'subtle'"
            @click="setPageSize(size)"
          />
          <Button
            label="All"
            size="sm"
            :variant="filters.page_length ? 'subtle' : 'solid'"
            @click="setPageSize(0)"
          />
        </div>
        <div class="flex items-center gap-2">
          <span class="text-sm text-ink-gray-5">Showing {{ rows.length }} of {{ total }}</span>
          <Button v-if="rows.length < total" label="Load More" size="sm" @click="loadMore" />
        </div>
      </div>
    </template>
  </div>
</template>
