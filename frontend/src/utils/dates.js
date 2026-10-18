// Dates for the special price: it starts the day the file is made and ends on
// a date the user picks (remembered between runs, while it is still ahead).
export const todayISO = () => {
  const d = new Date(), p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
export const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + n)
  const p = x => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const END_KEY = 'cartup.specialPriceEnd'
export function loadSpecialEnd() {
  let v = ''
  try { v = localStorage.getItem(END_KEY) || '' } catch { /* storage unavailable */ }
  return v && v > todayISO() ? v : addDays(todayISO(), 30)
}
export function saveSpecialEnd(v) {
  try { localStorage.setItem(END_KEY, v) } catch { /* storage unavailable */ }
}
