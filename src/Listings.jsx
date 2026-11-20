import { useState } from 'react'
import { cities } from './data.js'
import SearchMap from './SearchMap.jsx'
import { ListingCard, PriceInput } from './ui.jsx'
import { EMPTY_FILTERS, activeFilterCount, describeFilters } from './filters.js'
import { budgetHint, budgetLegend } from './price.js'

const BED_OPTIONS = [0, 1, 2, 3, 4, 5]

export function Filters({ filters, update, onClear }) {
  const [open, setOpen] = useState(false)
  const count = activeFilterCount({ ...filters, query: '' })
  const showPeriod = !filters.type || filters.type === 'Rent'
  return <div className="search-panel">
    <div className="search-main">
      <label className="search-field">
        <span className="visually-hidden">Search location or property</span>
        <span className="search-icon" aria-hidden="true">⌕</span>
        <input type="search" value={filters.query} onChange={(event) => update({ query: event.target.value })} placeholder="Search area, e.g. Molyko" enterKeyHint="search" />
      </label>
      <button type="button" className="filter-toggle" aria-expanded={open} aria-controls="filter-grid" onClick={() => setOpen(!open)}>
        Filters{count ? <span className="count">{count}</span> : null}
      </button>
    </div>
    <div id="filter-grid" className={`filter-grid${open ? ' open' : ''}`}>
      <label><span>City</span>
        <select value={filters.city} onChange={(event) => update({ city: event.target.value })}>
          <option value="">Any city</option>{cities.map((item) => <option key={item}>{item}</option>)}
        </select>
      </label>
      <label><span>Property type</span>
        <select value={filters.type} onChange={(event) => update({ type: event.target.value })}>
          <option value="">Any type</option><option>Rent</option><option>Sale</option><option>Guest house</option>
        </select>
      </label>
      <label><span>Bedrooms</span>
        <select value={filters.beds} onChange={(event) => update({ beds: Number(event.target.value) })}>
          {BED_OPTIONS.map((value) => <option key={value} value={value}>{value ? `${value}+ bedrooms` : 'Any'}</option>)}
        </select>
      </label>
      <label><span>Sort by</span>
        <select value={filters.sort} onChange={(event) => update({ sort: event.target.value })}>
          <option value="recommended">Recommended</option>
          <option value="price-asc">Price: low to high</option>
          <option value="price-desc">Price: high to low</option>
          <option value="newest">Newest first</option>
        </select>
      </label>
      <fieldset className="budget">
        <legend>{budgetLegend(filters.type, filters.budgetPeriod)}</legend>
        <div className="budget-row">
          <PriceInput aria-label="Minimum price in FCFA" placeholder="Min" value={filters.minPrice} onChange={(minPrice) => update({ minPrice })} />
          <span aria-hidden="true">to</span>
          <PriceInput aria-label="Maximum price in FCFA" placeholder="Max" value={filters.maxPrice} onChange={(maxPrice) => update({ maxPrice })} />
        </div>
        {showPeriod ? <div className="segmented" role="group" aria-label="Rent period">
          <button type="button" className={filters.budgetPeriod === 'month' ? 'selected' : ''} aria-pressed={filters.budgetPeriod === 'month'} onClick={() => update({ budgetPeriod: 'month' })}>Per month</button>
          <button type="button" className={filters.budgetPeriod === 'year' ? 'selected' : ''} aria-pressed={filters.budgetPeriod === 'year'} onClick={() => update({ budgetPeriod: 'year' })}>Per year</button>
        </div> : null}
        <small>{budgetHint(filters.type, filters.budgetPeriod)}. Type the full amount.</small>
      </fieldset>
      <div className="filter-foot">
        <label className="check"><input type="checkbox" checked={filters.showTaken} onChange={(event) => update({ showTaken: event.target.checked })} /> Show homes that are already taken</label>
        <button type="button" className="text-button" onClick={onClear}>Clear all filters</button>
      </div>
    </div>
  </div>
}

function Chips({ filters, update }) {
  const n = new Intl.NumberFormat('en-US')
  const chips = []
  if (filters.query) chips.push({ key: 'query', text: `"${filters.query}"`, clear: { query: '' } })
  if (filters.city) chips.push({ key: 'city', text: filters.city, clear: { city: '' } })
  if (filters.type) chips.push({ key: 'type', text: filters.type, clear: { type: '' } })
  if (filters.beds) chips.push({ key: 'beds', text: `${filters.beds}+ bedrooms`, clear: { beds: 0 } })
  if (filters.minPrice) chips.push({ key: 'min', text: `From ${n.format(filters.minPrice)} FCFA`, clear: { minPrice: null } })
  if (filters.maxPrice) chips.push({ key: 'max', text: `Up to ${n.format(filters.maxPrice)} FCFA`, clear: { maxPrice: null } })
  if (filters.showTaken) chips.push({ key: 'taken', text: 'Including taken', clear: { showTaken: false } })
  if (!chips.length) return null
  return <ul className="chips" aria-label="Active filters">
    {chips.map((chip) => <li key={chip.key}><button type="button" onClick={() => update(chip.clear)} aria-label={`Remove filter ${chip.text}`}>{chip.text}<span aria-hidden="true">×</span></button></li>)}
  </ul>
}

export default function Listings({ results, filters, update, onOpen, savedIds, onSave, onAlert, alertState }) {
  const [showMap, setShowMap] = useState(false)
  const clear = () => update({ ...EMPTY_FILTERS })
  return <section className="shell section listings-page">
    <p className="kicker">VERIFIED LISTINGS</p>
    <h1 className="page-title">Find your next home</h1>
    <Filters filters={filters} update={update} onClear={clear} />
    <div className="results-bar">
      <p className="result-count" role="status"><b>{results.length}</b> {results.length === 1 ? 'home' : 'homes'} found <span>{describeFilters(filters).replace(/^Homes ?/, '') || 'in all cities'}</span></p>
      <div className="results-actions">
        <button type="button" className={`secondary${showMap ? ' active' : ''}`} aria-expanded={showMap} aria-controls="results-map" onClick={() => setShowMap(!showMap)}>{showMap ? 'Hide map' : 'See location on map'}</button>
        <button type="button" className="secondary" onClick={onAlert} disabled={alertState === 'saving'}>{alertState === 'saved' ? 'Alert saved ✓' : alertState === 'saving' ? 'Saving…' : 'Notify me of new matches'}</button>
      </div>
    </div>
    <Chips filters={filters} update={update} />
    {showMap ? <div id="results-map"><SearchMap city={filters.city} query={filters.query} listings={results} /></div> : null}
    {results.length ? <div className="cards">{results.map((item) => <ListingCard key={item.id} listing={item} onOpen={onOpen} saved={savedIds.includes(item.id)} onSave={onSave} />)}</div> : <div className="empty">
      <h2>No homes match these filters yet</h2>
      <p>Try a wider budget or another city, or save this search and we will tell you when a matching home is published.</p>
      <div className="empty-actions"><button type="button" className="secondary" onClick={clear}>Clear filters</button><button type="button" className="primary" onClick={onAlert}>Notify me</button></div>
    </div>}
  </section>
}
