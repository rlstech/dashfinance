import { useState, type ReactNode } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
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

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
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
              <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-dark text-white text-xs font-black uppercase tracking-wide">
                {tag}
                <button
                  onClick={() => onRemoveTag?.(i)}
                  className="ml-0.5 text-red-400 hover:text-red-200 font-black leading-none"
                  aria-label={`Remover filtro ${tag}`}
                >×</button>
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
              className="w-full h-10 pl-9 pr-3 border-2 border-dark bg-white text-sm font-bold uppercase focus:outline-none focus:border-brand"
            />
          </div>
          {onAddTag && (
            <button
              onClick={() => { if (inputValue.trim()) { onAddTag(inputValue.trim()); setInputValue('') } }}
              className="h-10 px-3 border-2 border-dark bg-dark text-white text-xs font-black uppercase hover:bg-brand hover:text-dark transition-colors"
            >+</button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="block-border overflow-auto">
        <table className="w-full text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="bg-bgBase border-b-2 border-dark">
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    className={cn(
                      'px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-dark',
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
              <tr key={row.id} className="border-b border-grid hover:bg-bgBase transition-colors">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {table.getRowModel().rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-muted-foreground font-bold uppercase text-xs">
                  Nenhum registro encontrado
                </td>
              </tr>
            )}
          </tbody>
          {footerRow && (
            <tfoot className="border-t-2 border-dark bg-bgBase">
              {footerRow}
            </tfoot>
          )}
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-xs text-muted-foreground font-bold uppercase">
        <span>{data.length} registros</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className="h-8 w-8 border-2 border-dark flex items-center justify-center hover:bg-bgBase disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="font-black">
            {table.getState().pagination.pageIndex + 1} / {table.getPageCount()}
          </span>
          <button
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className="h-8 w-8 border-2 border-dark flex items-center justify-center hover:bg-bgBase disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
