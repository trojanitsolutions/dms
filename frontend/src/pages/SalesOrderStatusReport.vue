<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import {
  Badge,
  Button,
  Checkbox,
  DatePicker,
  Dialog,
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
  hidden?: number
}

interface Row {
  [fieldname: string]: unknown
}

interface SummaryCard {
  label: string
  value: number
  datatype: string
  currency?: string
  drilldown?: Record<string, string | number>
}

interface Reference {
  name: string
  docstatus: number
  state: 'Draft' | 'Submitted' | 'Cancelled'
  status: string
  is_return: number
  posting_date: string
  qty: number
  grand_total?: number
  outstanding_amount?: number | null
  currency?: string
}

interface StatusResponse {
  columns: Column[]
  data: Row[]
  report_summary: SummaryCard[]
}

type Theme = 'gray' | 'blue' | 'green' | 'amber' | 'red'

const SO_STATUSES = [
  'On Hold',
  'To Pay',
  'To Deliver and Bill',
  'To Bill',
  'To Deliver',
  'Completed',
  'Closed',
  'Cancelled',
]
const FULFILMENT_STATUSES = [
  'Fully Completed',
  'Delivered – Invoice Pending',
  'Partially Delivered',
  'Not Delivered',
  'Closed',
  'Cancelled',
]
const DELIVERY_STATUSES = [
  'Not Delivered',
  'Partly Delivered',
  'Fully Delivered',
  'Not Applicable',
  'Closed',
  'Cancelled',
]
const INVOICE_STATUSES = [
  'Not Invoiced',
  'Draft Invoice',
  'Partly Invoiced',
  'Fully Invoiced',
  'Closed',
  'Cancelled',
]

const STATUS_THEMES: Record<string, Theme> = {
  // Overall Fulfilment Status
  'Fully Completed': 'green',
  'Delivered – Invoice Pending': 'amber',
  'Partially Delivered': 'blue',
  'Not Delivered': 'red',
  Closed: 'gray',
  Cancelled: 'gray',
  // Delivery Status
  'Fully Delivered': 'green',
  'Partly Delivered': 'blue',
  'Not Applicable': 'gray',
  // Invoice Status
  'Fully Invoiced': 'green',
  'Partly Invoiced': 'blue',
  'Draft Invoice': 'amber',
  'Not Invoiced': 'red',
}
const STATE_THEMES: Record<string, Theme> = { Draft: 'amber', Submitted: 'green', Cancelled: 'gray' }
const STATE_TEXT: Record<string, string> = {
  Draft: 'text-ink-amber-3',
  Submitted: 'text-ink-blue-link',
  Cancelled: 'text-ink-gray-5 line-through',
}

const STATUS_FIELDS = new Set(['fulfilment_status', 'delivery_status', 'invoice_status'])
const PENDING_FIELDS = new Set(['pending_delivery_qty', 'pending_invoice_qty', 'draft_invoice_qty'])
const REFERENCE_FIELDS: Record<string, { doctype: string; refs: string }> = {
  sales_invoices: { doctype: 'Sales Invoice', refs: 'invoice_refs' },
  delivery_notes: { doctype: 'Delivery Note', refs: 'delivery_note_refs' },
}

const toDateString = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`
const today = new Date()
const yearAgo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate())

const filters = reactive({
  company: '',
  from_date: toDateString(yearAgo),
  to_date: toDateString(today),
  customer: '',
  sales_order: '',
  sales_person: '',
  sales_order_status: '',
  fulfilment_status: '',
  delivery_status: '',
  invoice_status: '',
  overdue_only: false,
  pending_delivery_only: false,
  pending_invoice_only: false,
  draft_invoice_only: false,
  // Visibility only: adds cancelled invoices to the references.
  show_all_invoices: false,
})
// Selected Sales Order IDs. Export downloads only these when any are selected.
const selected = ref<string[]>([])
const detailsRow = ref<Row | null>(null)

const report = useCall<StatusResponse, { filters: string }>({
  url: '/api/v2/method/dms.api.reports.get_sales_order_status',
  params: () => ({ filters: JSON.stringify(filters) }),
  refetch: true,
})

const numericTypes = new Set(['Float', 'Currency', 'Int'])
const columns = computed(() => (report.data?.columns ?? []).filter((col) => !col.hidden))
const rows = computed(() => report.data?.data ?? [])
const summary = computed(() => report.data?.report_summary ?? [])

// Clicking a card clears the drilldown filters, then applies its own.
function applyDrilldown(drilldown: Record<string, string | number>) {
  filters.fulfilment_status = String(drilldown.fulfilment_status ?? '')
  filters.delivery_status = String(drilldown.delivery_status ?? '')
  filters.invoice_status = String(drilldown.invoice_status ?? '')
  filters.overdue_only = Boolean(drilldown.overdue_only)
  filters.pending_delivery_only = Boolean(drilldown.pending_delivery_only)
  filters.pending_invoice_only = Boolean(drilldown.pending_invoice_only)
  filters.draft_invoice_only = Boolean(drilldown.draft_invoice_only)
}

const allSelected = computed(
  () => rows.value.length > 0 && rows.value.every((row) => isSelected(row)),
)
const someSelected = computed(() => !allSelected.value && rows.value.some((row) => isSelected(row)))

function isSelected(row: Row) {
  return selected.value.includes(String(row.sales_order))
}

function toggleRow(row: Row, checked: boolean | 1 | 0 | undefined) {
  const salesOrder = String(row.sales_order)
  selected.value = checked
    ? [...selected.value, salesOrder]
    : selected.value.filter((name) => name !== salesOrder)
}

function toggleAll(checked: boolean | 1 | 0 | undefined) {
  selected.value = checked ? rows.value.map((row) => String(row.sales_order)) : []
}

function parseRefs(json: unknown): Reference[] {
  try {
    return JSON.parse(String(json || '[]'))
  } catch {
    return []
  }
}

// Shows the currency code before the amount, e.g. "QAR 1,250.00".
const formatCurrency = (value: unknown, currency?: unknown) => {
  const amount = Number(value ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return currency ? `${currency} ${amount}` : amount
}

const exportUrl = computed(
  () =>
    `/api/method/dms.api.reports.export_sales_order_status?filters=${encodeURIComponent(
      JSON.stringify({ ...filters, selected: selected.value }),
    )}`,
)
</script>

<template>
  <PageHeader>
    <PageHeaderTitle title="Sales Order Status Report" />
  </PageHeader>

  <div class="w-full space-y-4 px-3 pb-10 pt-6 sm:px-5">
    <div class="flex flex-wrap items-end gap-3">
      <TextInput v-model="filters.company" label="Company" class="w-40" />
      <DatePicker v-model="filters.from_date" label="From Date" class="w-36" />
      <DatePicker v-model="filters.to_date" label="To Date" class="w-36" />
      <TextInput v-model="filters.customer" label="Customer" class="w-40" />
      <TextInput v-model="filters.sales_order" label="Sales Order" class="w-40" />
      <TextInput v-model="filters.sales_person" label="Sales Person" class="w-40" />
      <Select
        v-model="filters.sales_order_status"
        label="Sales Order Status"
        :options="['', ...SO_STATUSES]"
        class="w-44"
      />
      <Select
        v-model="filters.fulfilment_status"
        label="Fulfilment Status"
        :options="['', ...FULFILMENT_STATUSES]"
        class="w-52"
      />
      <Select
        v-model="filters.delivery_status"
        label="Delivery Status"
        :options="['', ...DELIVERY_STATUSES]"
        class="w-40"
      />
      <Select
        v-model="filters.invoice_status"
        label="Invoice Status"
        :options="['', ...INVOICE_STATUSES]"
        class="w-40"
      />
    </div>
    <div class="flex flex-wrap items-center gap-3">
      <Checkbox v-model="filters.overdue_only" label="Overdue Deliveries Only" />
      <Checkbox v-model="filters.pending_delivery_only" label="Pending Delivery Only" />
      <Checkbox v-model="filters.pending_invoice_only" label="Pending Invoice Only" />
      <Checkbox v-model="filters.draft_invoice_only" label="Draft Invoices Only" />
      <Checkbox v-model="filters.show_all_invoices" label="Show All Invoices" />
      <Button
        :label="selected.length ? `Export Selected (${selected.length})` : 'Export'"
        icon-left="lucide-download"
        :href="exportUrl"
      />
      <Button v-if="selected.length" label="Clear Selection" @click="selected = []" />
    </div>

    <div v-if="summary.length" class="flex flex-wrap gap-3">
      <component
        :is="card.drilldown ? 'button' : 'div'"
        v-for="card in summary"
        :key="card.label"
        class="min-w-40 rounded-6 border border-outline-gray-1 px-4 py-3 text-left"
        :class="card.drilldown ? 'hover:bg-surface-gray-2' : ''"
        :title="card.drilldown ? 'Click to filter' : undefined"
        @click="card.drilldown && applyDrilldown(card.drilldown)"
      >
        <p class="text-sm text-ink-gray-5">{{ card.label }}</p>
        <p class="mt-1 text-lg font-semibold text-ink-gray-8">
          {{ card.datatype === 'Currency' ? formatCurrency(card.value, card.currency) : card.value }}
        </p>
      </component>
    </div>

    <LoadingIndicator v-if="report.loading" class="mx-auto size-6 text-ink-gray-5" />
    <ErrorMessage v-else-if="report.error" :message="report.error" />
    <div
      v-else-if="!rows.length"
      class="flex flex-col items-center justify-center gap-3 py-16 text-center"
    >
      <span class="lucide-clipboard-list size-6 text-ink-gray-5" aria-hidden="true" />
      <p class="text-sm text-ink-gray-5">No sales orders for these filters.</p>
    </div>
    <div v-else class="overflow-x-auto rounded-6 border border-outline-gray-1">
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
            <th class="px-4 py-2 font-medium">#</th>
            <th
              v-for="col in columns"
              :key="col.fieldname"
              class="whitespace-nowrap px-4 py-2 font-medium"
              :class="numericTypes.has(col.fieldtype) ? 'text-right' : 'text-left'"
            >
              {{ col.label }}
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-outline-gray-1">
          <tr
            v-for="(row, i) in rows"
            :key="String(row.sales_order)"
            :class="isSelected(row) ? 'bg-surface-gray-2' : ''"
          >
            <td class="w-10 px-4 py-2">
              <Checkbox
                :model-value="isSelected(row)"
                :aria-label="`Select ${row.sales_order}`"
                @update:model-value="(checked) => toggleRow(row, checked)"
              />
            </td>
            <td class="px-4 py-2 text-ink-gray-7">{{ i + 1 }}</td>
            <td
              v-for="col in columns"
              :key="col.fieldname"
              class="whitespace-nowrap px-4 py-2"
              :class="
                numericTypes.has(col.fieldtype) ? 'text-right text-ink-gray-7' : 'text-ink-gray-8'
              "
            >
              <Badge
                v-if="STATUS_FIELDS.has(col.fieldname) && row[col.fieldname]"
                :label="String(row[col.fieldname])"
                :theme="STATUS_THEMES[String(row[col.fieldname])] ?? 'gray'"
              />
              <div
                v-else-if="REFERENCE_FIELDS[col.fieldname]"
                class="flex items-center gap-2"
              >
                <template v-if="parseRefs(row[REFERENCE_FIELDS[col.fieldname].refs]).length">
                  <button
                    class="text-xs text-ink-gray-5 hover:text-ink-gray-8"
                    title="View details"
                    @click="detailsRow = row"
                  >
                    <span class="lucide-info size-4" aria-hidden="true" />
                  </button>
                  <a
                    v-for="ref in parseRefs(row[REFERENCE_FIELDS[col.fieldname].refs])"
                    :key="ref.name"
                    :href="deskLink(REFERENCE_FIELDS[col.fieldname].doctype, ref.name)"
                    target="_blank"
                    class="hover:underline"
                    :class="STATE_TEXT[ref.state]"
                    :title="`${ref.state} · ${ref.status ?? ''}${ref.is_return ? ' · Return' : ''}`"
                  >
                    {{ ref.name }}
                  </a>
                </template>
              </div>
              <a
                v-else-if="col.fieldtype === 'Link' && col.options && row[col.fieldname]"
                :href="deskLink(col.options, String(row[col.fieldname]))"
                target="_blank"
                class="text-ink-blue-link hover:underline"
              >
                {{ row[col.fieldname] }}
              </a>
              <template v-else-if="col.fieldtype === 'Currency'">
                {{ formatCurrency(row[col.fieldname], row.currency) }}
              </template>
              <template v-else-if="col.fieldname === 'days_overdue'">
                <span v-if="Number(row.days_overdue) > 0" class="font-semibold text-ink-red-4">
                  {{ row.days_overdue }}
                </span>
              </template>
              <span
                v-else-if="PENDING_FIELDS.has(col.fieldname)"
                :class="Number(row[col.fieldname]) > 0 ? 'text-ink-amber-3' : ''"
              >
                {{ row[col.fieldname] }}
              </span>
              <template v-else>{{ row[col.fieldname] ?? '' }}</template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <Dialog
    :open="Boolean(detailsRow)"
    :title="`Linked Documents for ${detailsRow?.sales_order ?? ''}`"
    size="4xl"
    @update:open="(open) => !open && (detailsRow = null)"
  >
    <div v-if="detailsRow" class="space-y-4 text-sm">
      <template v-for="(field, key) in REFERENCE_FIELDS" :key="key">
        <h4 class="font-semibold text-ink-gray-8">{{ field.doctype }}s</h4>
        <p v-if="!parseRefs(detailsRow[field.refs]).length" class="text-ink-gray-5">None</p>
        <div v-else class="overflow-x-auto rounded-6 border border-outline-gray-1">
          <table class="w-full text-left">
            <thead>
              <tr class="border-b border-outline-gray-1 text-ink-gray-6">
                <th class="px-3 py-2 font-medium">{{ field.doctype }}</th>
                <th class="px-3 py-2 font-medium">Document Status</th>
                <th class="px-3 py-2 font-medium">Status</th>
                <th class="px-3 py-2 font-medium">Posting Date</th>
                <th class="px-3 py-2 text-right font-medium">Qty</th>
                <template v-if="key === 'sales_invoices'">
                  <th class="px-3 py-2 text-right font-medium">Grand Total</th>
                  <th class="px-3 py-2 text-right font-medium">Outstanding</th>
                </template>
              </tr>
            </thead>
            <tbody class="divide-y divide-outline-gray-1">
              <tr v-for="ref in parseRefs(detailsRow[field.refs])" :key="ref.name">
                <td class="px-3 py-2">
                  <a
                    :href="deskLink(field.doctype, ref.name)"
                    target="_blank"
                    class="text-ink-blue-link hover:underline"
                  >
                    {{ ref.name }}
                  </a>
                  <span v-if="ref.is_return" class="text-ink-gray-5"> (Return)</span>
                </td>
                <td class="px-3 py-2">
                  <Badge :label="ref.state" :theme="STATE_THEMES[ref.state]" />
                </td>
                <td class="px-3 py-2 text-ink-gray-7">{{ ref.status }}</td>
                <td class="px-3 py-2 text-ink-gray-7">{{ ref.posting_date }}</td>
                <td class="px-3 py-2 text-right text-ink-gray-7">{{ ref.qty }}</td>
                <template v-if="key === 'sales_invoices'">
                  <td class="px-3 py-2 text-right text-ink-gray-7">
                    {{ formatCurrency(ref.grand_total, ref.currency) }}
                  </td>
                  <td class="px-3 py-2 text-right text-ink-gray-7">
                    {{
                      ref.outstanding_amount == null
                        ? ''
                        : formatCurrency(ref.outstanding_amount, ref.currency)
                    }}
                  </td>
                </template>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <p class="text-xs text-ink-gray-5">
        {{
          filters.show_all_invoices
            ? 'Showing all invoices, including cancelled.'
            : 'Cancelled invoices are hidden. Enable Show All Invoices to see them.'
        }}
        Qty is the quantity of this order on the invoice. Grand Total is the whole invoice.
      </p>
    </div>
  </Dialog>
</template>
