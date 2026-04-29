import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

export const getJobs = (params) => api.get('/jobs', { params })
export const createJob = (data) => api.post('/jobs', data)
export const getJob = (id) => api.get(`/jobs/${id}`)
export const updateJob = (id, data) => api.put(`/jobs/${id}`, data)
export const deleteJob = (id) => api.delete(`/jobs/${id}`)

export const addCostLine = (jobId, data) => api.post(`/jobs/${jobId}/costs`, data)
export const updateCostLine = (jobId, lid, data) => api.put(`/jobs/${jobId}/costs/${lid}`, data)
export const deleteCostLine = (jobId, lid) => api.delete(`/jobs/${jobId}/costs/${lid}`)

export const addBillingLine = (jobId, data) => api.post(`/jobs/${jobId}/billing`, data)
export const updateBillingLine = (jobId, lid, data) => api.put(`/jobs/${jobId}/billing/${lid}`, data)
export const deleteBillingLine = (jobId, lid) => api.delete(`/jobs/${jobId}/billing/${lid}`)

export const uploadDocument = (jobId, file, doc_type) => {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('doc_type', doc_type)
  return api.post(`/jobs/${jobId}/documents`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
}
export const deleteDocument = (jobId, did) => api.delete(`/jobs/${jobId}/documents/${did}`)

export const parseEmail = (text) => api.post('/parse-email', { text })

export const parseInvoice = (file) => {
  const fd = new FormData()
  fd.append('file', file)
  return api.post('/parse-invoice', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
}

export const getDashboard = () => api.get('/dashboard')

export default api
