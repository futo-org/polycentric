import { useEffect, useState } from 'react'
import { Profile } from '../../../types/profile'
import { useDebounce } from '@uidotdev/usehooks'
import { Link } from 'react-router-dom'

interface ResultsPreview {
  accounts: Profile[]
  topics: string[]
}

export const SearchBox = ({
  getResultsPreview,
  debounceMs = 200,
}: {
  getResultsPreview: (query: string) => Promise<ResultsPreview>
  debounceMs: number
}) => {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounce(query, debounceMs)
  const [results, setResults] = useState<ResultsPreview | null>(null)

  useEffect(() => {
    if (debouncedQuery && debouncedQuery.length > 0) {
      getResultsPreview(debouncedQuery).then(setResults)
    }
  }, [debouncedQuery, getResultsPreview])

  return (
    <div className="flex flex-col space-y-2">
      <input
        type="text"
        placeholder="Search..."
        className="rounded-lg border text-xl p-3"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {query.length > 0 && results && (
        <div className="relative">
          <div className="flex flex-col space-y-0 border rounded-lg bg-white absolute w-full">
            <div className="flex flex-col space-y-1.5 py-3 px-1">
              <h3 className="font-medium pl-2.5">Accounts</h3>
              <div className="flex flex-col">
                {results?.accounts.map((account) => (
                  <Link className="flex items-center space-x-3 hover:bg-gray-100 p-3 rounded-md cursor-default" to="/">
                    <img src={account.avatarURL} className="w-10 h-10 rounded-full " />
                    <div className="flex flex-col">
                      <div className="text-gray-500">{account.name}</div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
            {/* Little decorative circle divider */}
            <div className="flex justify-center relative">
              <div className="w-3 h-3 border-2 border-gray-200 rounded-full"></div>
              <div className="w-3 h-3 border-2 border-gray-200 rounded-full -ml-1"></div>
              <div className="w-3 h-3 border-2 border-gray-200 rounded-full -ml-1"></div>
            </div>
            <div className="flex flex-col space-y-1.5 py-3 px-1">
              <h3 className="font-medium pl-2.5">Topics</h3>
              <Link className="flex flex-col cursor-default" to="/">
                {results?.topics.map((topic) => (
                  <div className="flex items-center space-x-3 hover:bg-gray-100 p-3 rounded-md">
                    <div className="flex flex-col">
                      <div className="text-gray-500">{topic}</div>
                    </div>
                  </div>
                ))}
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
