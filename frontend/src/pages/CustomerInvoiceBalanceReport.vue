<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import {
  Button,
  Checkbox,
  DatePicker,
  ErrorMessage,
  LoadingIndicator,
  PageHeader,
  PageHeaderTitle,
  TextInput,
  useCall,
} from 'frappe-ui'
import SearchPicker from '../components/SearchPicker.vue'
import { deskLink } from '../utils'
import { openPrintWindow, printReport } from '../printReport'

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

interface InvoiceBalanceResponse {
  columns: Column[]
  data: Row[]
  report_summary: SummaryCard[]
}

const PAGE_SIZES = [20, 100, 500, 2500]

const defaultFilters = () => ({
  company: '',
  customer: '',
  customer_group: '',
  posting_date: '',
  from_date: '',
  to_date: '',
  show_paid_invoices: false,
  // Empty means all rows.
  page_length: PAGE_SIZES[0] as number | null,
})
const filters = reactive(defaultFilters())
// The Customer Balance page links here with `?customer=...&company=...`.
const route = useRoute()
for (const key of ['customer', 'company'] as const) {
  const value = route.query[key]
  if (typeof value === 'string') filters[key] = value
}
const step = ref(PAGE_SIZES[0])

// True when any filter differs from its default. Paging does not count.
const hasFilters = computed(() => {
  const defaults = defaultFilters()
  return (Object.keys(defaults) as (keyof typeof defaults)[]).some(
    (key) => key !== 'page_length' && filters[key] !== defaults[key],
  )
})

// Reset all filters, the page size and the row selection.
function clearFilters() {
  Object.assign(filters, defaultFilters())
  step.value = PAGE_SIZES[0]
  selected.value = []
}
// Selected invoice IDs. Export downloads only these when any are selected.
const selected = ref<string[]>([])

const report = useCall<InvoiceBalanceResponse, { filters: string }>({
  url: '/api/v2/method/dms.api.reports.get_customer_invoice_balance',
  params: () => ({ filters: JSON.stringify(filters) }),
  refetch: true,
})

const numericTypes = new Set(['Float', 'Currency', 'Int'])
const columns = computed(() => (report.data?.columns ?? []).filter((col) => !col.hidden))
const rows = computed(() => report.data?.data ?? [])
const summary = computed(() => report.data?.report_summary ?? [])
const total = computed(
  () => summary.value.find((card) => card.key === 'total_invoices')?.value ?? rows.value.length,
)

const allSelected = computed(
  () => rows.value.length > 0 && rows.value.every((row) => isSelected(row)),
)
const someSelected = computed(() => !allSelected.value && rows.value.some((row) => isSelected(row)))

function isSelected(row: Row) {
  return selected.value.includes(String(row.invoice))
}

function toggleRow(row: Row, checked: boolean | 1 | 0 | undefined) {
  const invoice = String(row.invoice)
  selected.value = checked
    ? [...selected.value, invoice]
    : selected.value.filter((name) => name !== invoice)
}

function toggleAll(checked: boolean | 1 | 0 | undefined) {
  selected.value = checked ? rows.value.map((row) => String(row.invoice)) : []
}

// Shows the currency code before the amount, e.g. "QAR 1,250.00".
const formatCurrency = (value: unknown, currency?: unknown) => {
  const amount = Number(value ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return currency ? `${currency} ${amount}` : amount
}

// Red for money still owed, amber for days past due.
function cellClass(col: Column, row: Row) {
  if (col.fieldname === 'outstanding_amount' && Number(row.outstanding_amount) > 0) {
    return 'text-right text-ink-red-4'
  }
  if (col.fieldname === 'overdue_days' && Number(row.overdue_days) > 0) {
    return 'text-right text-ink-amber-3'
  }
  return numericTypes.has(col.fieldtype) ? 'text-right text-ink-gray-7' : 'text-ink-gray-8'
}

function setPageSize(size: number) {
  if (size) step.value = size
  filters.page_length = size || null
}

function loadMore() {
  // Load the next page of the selected size.
  filters.page_length = rows.value.length + step.value
}

// Print format set for this report in Sales Management Settings. No format hides Print.
const printFormat = useCall<string | null, { report: string }>({
  url: '/api/v2/method/dms.api.reports.get_report_print_format_name',
  params: () => ({ report: 'Customer Invoice Balance' }),
})
const printing = ref(false)
const printError = ref('')

interface PrintResponse {
  html: string
  css: string | null
  data: Row[]
  statement_details: { currency?: string }
}

async function print() {
  printError.value = ''
  let win: Window | null = null
  printing.value = true
  try {
    win = openPrintWindow()
    const query = new URLSearchParams({
      filters: JSON.stringify({ ...filters, selected: selected.value }),
    })
    const response = await fetch(
      `/api/v2/method/dms.api.reports.get_customer_invoice_balance_print?${query}`,
    )
    const body = await response.json()
    if (!response.ok) throw new Error(body.errors?.[0]?.message || 'Could not print the report.')
    const result = body.data as PrintResponse
    printReport(win, {
      title: 'Customer Invoice Balance',
      html: result.html,
      css: result.css,
      currency: result.statement_details.currency,
      context: {
        data: result.data,
        filters: { ...filters },
        report: { statement_details: result.statement_details },
      },
    })
  } catch (e) {
    win?.close()
    printError.value = e instanceof Error ? e.message : String(e)
  } finally {
    printing.value = false
  }
}

const exportUrl = computed(
  () =>
    `/api/method/dms.api.reports.export_customer_invoice_balance?filters=${encodeURIComponent(
      JSON.stringify({ ...filters, selected: selected.value }),
    )}`,
)
</script>

<template>
  <PageHeader>
    <PageHeaderTitle title="Customer Invoice Balance Report" />
  </PageHeader>

  <div class="w-full space-y-4 px-3 pb-10 pt-6 sm:px-5">
    <div class="flex flex-wrap items-end gap-3">
      <TextInput v-model="filters.company" label="Company" :debounce="300" class="w-40" />
      <SearchPicker
        v-model="filters.customer"
        label="Customer"
        placeholder="Search customer name or ID"
        url="/api/v2/method/dms.api.reports.search_customers"
      />
      <TextInput
        v-model="filters.customer_group"
        label="Customer Group"
        :debounce="300"
        class="w-40"
      />
      <DatePicker v-model="filters.posting_date" label="Posting Date" class="w-36" />
      <DatePicker v-model="filters.from_date" label="From Date" class="w-36" />
      <DatePicker v-model="filters.to_date" label="To Date" class="w-36" />
      <Checkbox v-model="filters.show_paid_invoices" label="Show Paid Invoices" />
      <Button
        v-if="hasFilters"
        label="Clear Filters"
        icon-left="lucide-x"
        variant="subtle"
        @click="clearFilters"
      />
      <Button
        :label="selected.length ? `Export Selected (${selected.length})` : 'Export'"
        icon-left="lucide-download"
        :href="exportUrl"
      />
      <Button
        v-if="printFormat.data"
        :label="selected.length ? `Print Selected (${selected.length})` : 'Print'"
        icon-left="lucide-printer"
        :loading="printing"
        @click="print"
      />
      <Button v-if="selected.length" label="Clear Selection" @click="selected = []" />
    </div>

    <ErrorMessage v-if="printError" :message="printError" />

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
      <span class="lucide-receipt size-6 text-ink-gray-5" aria-hidden="true" />
      <p class="text-sm text-ink-gray-5">No invoices with a balance for these filters.</p>
    </div>
    <template v-else>
      <!-- Scrolls both ways and keeps the header row in view. -->
      <div class="max-h-[calc(100vh-320px)] overflow-auto rounded-6 border border-outline-gray-1">
        <table class="w-full whitespace-nowrap text-left text-sm">
          <thead class="sticky top-0 z-10 bg-surface-base">
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
              v-for="row in rows"
              :key="String(row.invoice)"
              :class="isSelected(row) ? 'bg-surface-gray-2' : ''"
            >
              <td class="w-10 px-4 py-2">
                <Checkbox
                  :model-value="isSelected(row)"
                  :aria-label="`Select ${row.invoice}`"
                  @update:model-value="(checked) => toggleRow(row, checked)"
                />
              </td>
              <td
                v-for="col in columns"
                :key="col.fieldname"
                class="px-4 py-2"
                :class="cellClass(col, row)"
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
