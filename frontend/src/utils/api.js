const API_URL = 'https://cartup-content.onrender.com'

export async function login(email, password) {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw new Error('Invalid credentials')
  return res.json()
}

export async function getMe(token) {
  const res = await fetch(`${API_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Unauthorized')
  return res.json()
}

export async function uploadDarazFiles(files, token) {
  const form = new FormData()
  form.append('price_file',  files.price)
  form.append('basic_file',  files.basic)
  form.append('weight_file', files.weight)
  form.append('skuimg_file', files.skuimg)
  if (files.attr) form.append('attr_file', files.attr)

  const res = await fetch(`${API_URL}/production/daraz-upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Processing failed')
  }
  return res.blob()
}

export async function uploadManualFile(file, token) {
  const form = new FormData()
  form.append('input_file', file)
  const res = await fetch(`${API_URL}/production/manual-upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  if (!res.ok) throw new Error('Processing failed')
  return res.blob()
}
