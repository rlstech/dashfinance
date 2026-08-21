import { useState, type ReactNode } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { ChevronUp, ChevronDown, Search, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DataTableProps<T> {
  data: T[]
  columns: ColumnDef<T, unknown>[]
  pageSize?: number
  searchPlaceholder?: string
  footerRow?: ReactNode
  searchTags?: string[]
  onAddTag?: (tag: string) => void
  onRemoveTag?: (index: number) => void
}

export function DataTable<T>({ data, columns, pageSize = 20, searchPlaceholder = 'Buscar...', footerRow, searchTags, onAddTag, onRemoveTag }: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [inputValue, setInputValue] = useState('')

  // TanStack Table exposes an imperative instance that React Compiler cannot memoize safely.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter: inputValue },
    onSortingChange: setSorting,
    onGlobalFilterChange: setInputValue,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    autoResetPageIndex: true,
    initialState: { pagination: { pageSize } },
  })

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="space-y-2">
        {searchTags && searchTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {searchTags.map((tag, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-full bg-dark px-2.5 py-1 text-xs font-medium text-white">
                {tag}
                <button
                  type="button"
                  onClick={() => onRemoveTag?.(i)}
                  className="ml-0.5 leading-none text-white/60 transition-colors hover:text-white"
                  aria-label={`Remover filtro ${tag}`}
                >x</button>
              </span>
            ))}
          </div>
        )}
        <div className="relative flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder={searchPlaceholder}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && inputValue.trim()) {
                  onAddTag?.(inputValue.trim())
                  setInputValue('')
                }
              }}
              className="h-10 w-full rounded-md border border-line bg-white pl-9 pr-3 text-sm font-medium text-dark focus:outline-none focus:ring-2 focus:ring-brand/25"
            />
          </div>
          {onAddTag && (
            <button
              type="button"
              onClick={() => { if (inputValue.trim()) { onAddTag(inputValue.trim()); setInputValue('') } }}
              className="h-10 rounded-md bg-dark px-3 text-xs font-semibold text-white transition-colors hover:bg-brand hover:text-dark"
              aria-label="Adicionar filtro de busca"
            >Adicionar</button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="data-panel overflow-auto">
        <table className="w-full text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-line bg-bgBase">
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    className={cn(
                      'px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground',
                      header.column.getCanSort() && 'cursor-pointer select-none hover:text-brand'
                    )}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    <div className="flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getIsSorted() === 'asc' && <ChevronUp className="h-3 w-3" />}
                      {header.column.getIsSorted() === 'desc' && <ChevronDown className="h-3 w-3" />}
                    </div>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-b border-grid transition-colors last:border-0 hover:bg-bgBase">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {table.getRowModel().rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-xs font-medium text-muted-foreground">
                  Nenhum registro encontrado
                </td>
              </tr>
            )}
          </tbody>
          {footerRow && (
            <tfoot className="border-t border-line bg-bgBase">
              {footerRow}
            </tfoot>
          )}
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>{table.getFilteredRowModel().rows.length} registros</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-line transition-colors hover:border-brand hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="font-black">
            {table.getState().pagination.pageIndex + 1} / {table.getPageCount()}
          </span>
          <button
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-line transition-colors hover:border-brand hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
