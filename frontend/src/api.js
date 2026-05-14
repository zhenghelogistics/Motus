import axios from 'axios'
import { supabase } from './lib/supabase'

const api = axios.create({ baseURL: '/api' })

// Attach the auth token to every request automatically
api.interceptors.request.use(async (config) => {
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`
  }
  return config
})

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

export const parseEmailFile = (file) => {
  const fd = new FormData()
  fd.append('file', file)
  return api.post('/parse-email-file', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
}

export const parseInvoice = (file) => {
  const fd = new FormData()
  fd.append('file', file)
  return api.post('/parse-invoice', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
}

export const getDashboard = () => api.get('/dashboard')

export const getFxRates = () => api.get('/fx-rates')
export const updateFxRates = (rates) => api.put('/fx-rates', { rates })

export const getCustomers = (search) => api.get('/customers', { params: search ? { search } : {} })
export const getStaff = () => api.get('/staff')

export const getCompanyStats = (params) => api.get('/stats/company', { params })
export const getCompanyList = () => api.get('/stats/companies')

export const getLeads = (params) => api.get('/leads', { params })
export const createLead = (data) => api.post('/leads', data)
export const updateLead = (id, data) => api.put(`/leads/${id}`, data)
export const getLeadStats = () => api.get('/leads/stats')
export const claimLead = (id) => api.put(`/leads/${id}/claim`)
export const generateEmail = (id, data) => api.post(`/leads/${id}/generate-email`, data)

export const unlockFxRate = (currency) => api.put(`/fx-rates/${currency}/unlock`)

export const linkInventoryMovement = (jobId) => api.post(`/jobs/${jobId}/inventory-link`)
export const voidInventoryMovement = (jobId) => api.put(`/jobs/${jobId}/inventory-void`)

export const getMarketingContacts = () => api.get('/marketing-contacts')
export const deleteMarketingContact = (id) => api.delete(`/marketing-contacts/${id}`)

export default api
