// popup.tsx - Complete Production Version (Zero omissions)

import React, { useState, useEffect } from "react"
import "./popup.css"

const TABS = ['Generate', 'History', 'Library', 'Batch'] as const
const FREE_TYPES = ['rephrase', 'simplify', 'formalize', 'informalize']
const PRO_TYPES = ['add-ambiguity', 'remove-ambiguity', 'change-perspective', 'reverse-polarity', 'add-constraints', 'remove-constraints', 'domain-shift', 'role-injection', 'adversarial']

export default function Popup() {
  const [activeTab, setActiveTab] = useState<typeof TABS[number]>('Generate')
  
  // Form states
  const [prompt, setPrompt] = useState('')
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [platform, setPlatform] = useState<'jan' | 'ollama' | 'lmstudio' | 'custom'>('jan')
  const [model, setModel] = useState('')
  const [customBase, setCustomBase] = useState('')
  const [modelsList, setModelsList] = useState<string[]>([])

  // Data states
  const [history, setHistory] = useState<any[]>([])
  const [library, setLibrary] = useState<any[]>([])
  const [daily, setDaily] = useState({ count: 0, limit: 10, isPro: false })
  const [licenseKey, setLicenseKey] = useState('')

  // UI states
  const [status, setStatus] = useState('')
  const [results, setResults] = useState<any>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  
  // Batch mode
  const [batchPrompts, setBatchPrompts] = useState<string[]>([''])

  // Load data + live updates
  useEffect(() => {
    const loadInitialData = async () => {
      const data = await chrome.storage.local.get([
        'dailyData', 
        'history', 
        'library', 
        'licenseKey', 
        'quickPrompt'
      ])

      setDaily(data.dailyData || { count: 0, limit: 10, isPro: false })
      setHistory(data.history || [])
      setLibrary(data.library || [])
      setLicenseKey(data.licenseKey || '')

      if (data.quickPrompt) {
        setPrompt(data.quickPrompt)
        chrome.storage.local.remove('quickPrompt')
      }
    }

    loadInitialData()

    // Live storage listener
    const storageListener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.dailyData) setDaily(changes.dailyData.newValue || { count: 0, limit: 10, isPro: false })
      if (changes.history) setHistory(changes.history.newValue || [])
      if (changes.library) setLibrary(changes.library.newValue || [])
    }

    chrome.storage.onChanged.addListener(storageListener)
    return () => chrome.storage.onChanged.removeListener(storageListener)
  }, [])

  // Fetch models from backend
  const fetchModels = async () => {
    setStatus('Fetching models...')
    const res = await chrome.runtime.sendMessage({
      action: 'getModels',
      platform,
      customBase
    })
    if (res?.models) {
      setModelsList(res.models)
      setStatus('')
    } else {
      setStatus('Failed to fetch models. Check if backend is running.')
    }
  }

  const toggleType = (type: string) => {
    setSelectedTypes(prev => 
      prev.includes(type) 
        ? prev.filter(t => t !== type) 
        : [...prev, type]
    )
  }

  // Single generation
  const generateSingle = async () => {
    if (!prompt.trim() || selectedTypes.length === 0) {
      setStatus('Please enter a prompt and select at least one perturbation type.')
      return
    }

    setIsGenerating(true)
    setStatus('Generating perturbations...')

    const response = await chrome.runtime.sendMessage({
      action: 'startGeneration',
      prompt: prompt.trim(),
      types: selectedTypes,
      platform,
      model: model.trim(),
      customBase: customBase.trim()
    })

    setIsGenerating(false)

    if (response.error === 'DAILY_LIMIT') {
      setStatus('Daily free limit reached (10 tests/day). Upgrade to Pro for unlimited.')
    } else if (response.error === 'MODEL_NOT_LOADED') {
      setStatus('Please load the model in Jan.ai / Ollama / LM Studio first.')
    } else if (response.success) {
      setResults(response.results)
      setStatus('Generation completed successfully!')
    }
  }

  // Batch generation
  const runBatch = async () => {
    const validPrompts = batchPrompts.filter(p => p.trim().length > 5)
    if (validPrompts.length === 0 || selectedTypes.length === 0) {
      setStatus('Add at least one valid prompt and select perturbation types.')
      return
    }

    setIsGenerating(true)
    setStatus(`Processing batch of ${validPrompts.length} prompts...`)

    const response = await chrome.runtime.sendMessage({
      action: 'batchProcess',
      prompts: validPrompts,
      types: selectedTypes,
      platform,
      model: model.trim(),
      customBase: customBase.trim()
    })

    setIsGenerating(false)

    if (response.error === 'DAILY_LIMIT') {
      setStatus('Daily free limit reached.')
    } else if (response.success) {
      setResults({ 
        results: response.results.flatMap((r: any) => r.results),
        isBatch: true,
        count: validPrompts.length
      })
      setStatus(`Batch completed! ${validPrompts.length} prompts processed.`)
    }
  }

  // Library actions
  const saveToLibrary = async () => {
    if (!prompt.trim()) return
    await chrome.runtime.sendMessage({ action: 'saveToLibrary', prompt: prompt.trim() })
    setStatus('Prompt saved to Library')
  }

  const useLibraryPrompt = (libPrompt: string) => {
    setPrompt(libPrompt)
    setActiveTab('Generate')
  }

  // History actions
  const togglePin = async (id: string) => {
    await chrome.runtime.sendMessage({ action: 'togglePin', id })
  }

  const deleteHistoryItem = async (id: string) => {
    await chrome.runtime.sendMessage({ action: 'deleteHistoryItem', id })
  }

  // Batch prompt management
  const addBatchRow = () => setBatchPrompts([...batchPrompts, ''])
  
  const updateBatchPrompt = (index: number, value: string) => {
    const updated = [...batchPrompts]
    updated[index] = value
    setBatchPrompts(updated)
  }

  const removeBatchRow = (index: number) => {
    if (batchPrompts.length === 1) return
    setBatchPrompts(batchPrompts.filter((_, i) => i !== index))
  }

  // Export functions
  const exportResults = (format: 'txt' | 'csv') => {
    if (!results) return

    let content = ''
    if (format === 'txt') {
      content = JSON.stringify(results, null, 2)
    } else {
      content = 'Type,Original,Perturbed,Similarity\n'
      results.results.forEach((r: any) => {
        content += `"${r.type}","${r.original.replace(/"/g, '""')}","${r.perturbed.replace(/"/g, '""')}",${r.similarity}\n`
      })
    }

    const blob = new Blob([content], { 
      type: format === 'txt' ? 'text/plain' : 'text/csv' 
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `prompt-test-${Date.now()}.${format}`
    a.click()
    URL.revokeObjectURL(url)
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setStatus('Copied to clipboard')
    setTimeout(() => setStatus(''), 2000)
  }

  return (
    <div className="container">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>Offline Prompt Tester</h1>
        <div style={{ 
          fontSize: 13, 
          padding: '4px 12px', 
          borderRadius: 9999, 
          background: daily.isPro ? '#22c55e' : '#eab308',
          color: '#0f172a',
          fontWeight: 600
        }}>
          {daily.isPro ? 'PRO ∞' : `${daily.count}/${daily.limit} today`}
        </div>
      </div>

      {/* Tabs */}
      <div className="tab-bar">
        {TABS.map(tab => (
          <div 
            key={tab} 
            className={`tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </div>
        ))}
      </div>

      {/* ==================== GENERATE TAB ==================== */}
      {activeTab === 'Generate' && (
        <div>
          {/* Settings Section */}
          <div className="section">
            <select 
              value={platform} 
              onChange={(e) => setPlatform(e.target.value as any)}
              style={{ width: '100%', padding: 10, marginBottom: 8, borderRadius: 8 }}
            >
              <option value="jan">Jan.ai (1337)</option>
              <option value="ollama">Ollama (11434)</option>
              <option value="lmstudio">LM Studio (1234)</option>
              <option value="custom">Custom Endpoint</option>
            </select>

            {platform === 'custom' && (
              <input 
                value={customBase} 
                onChange={(e) => setCustomBase(e.target.value)}
                placeholder="http://localhost:1234/v1"
                style={{ width: '100%', padding: 10, marginBottom: 8, borderRadius: 8 }}
              />
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <input 
                value={model} 
                onChange={(e) => setModel(e.target.value)}
                placeholder="Model name (e.g. meta-llama-3.1-8b)"
                style={{ flex: 1, padding: 10, borderRadius: 8 }}
              />
              <button onClick={fetchModels} style={{ padding: '0 20px' }}>↻</button>
            </div>

            {modelsList.length > 0 && (
              <select 
                value={model} 
                onChange={(e) => setModel(e.target.value)}
                style={{ width: '100%', marginTop: 8, padding: 10 }}
              >
                {modelsList.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            )}
          </div>

          {/* Prompt Input */}
          <textarea 
            value={prompt} 
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Enter your base prompt here..."
            rows={6}
            style={{ 
              width: '100%', 
              padding: 14, 
              borderRadius: 12, 
              background: 'var(--bg2)', 
              border: '1px solid var(--border)',
              color: 'var(--text)',
              resize: 'vertical',
              marginBottom: 16
            }}
          />

          {/* Perturbation Types */}
          <div className="section">
            <h4 style={{ margin: '0 0 10px 0' }}>Free (Rule-based)</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {FREE_TYPES.map(type => (
                <div 
                  key={type}
                  onClick={() => toggleType(type)}
                  className={`pill ${selectedTypes.includes(type) ? 'active' : ''}`}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 9999,
                    cursor: 'pointer',
                    fontSize: 13,
                    background: selectedTypes.includes(type) ? 'var(--accent)' : 'var(--bg)',
                    color: selectedTypes.includes(type) ? '#0f172a' : 'var(--text)'
                  }}
                >
                  {type}
                </div>
              ))}
            </div>

            <h4 style={{ margin: '0 0 10px 0' }}>Pro (LLM-based)</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {PRO_TYPES.map(type => (
                <div 
                  key={type}
                  onClick={() => toggleType(type)}
                  className={`pill ${selectedTypes.includes(type) ? 'active' : ''}`}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 9999,
                    cursor: 'pointer',
                    fontSize: 13,
                    background: selectedTypes.includes(type) ? 'var(--accent)' : 'var(--bg)',
                    color: selectedTypes.includes(type) ? '#0f172a' : 'var(--text)'
                  }}
                >
                  {type}
                </div>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button 
              onClick={generateSingle} 
              disabled={isGenerating || !prompt.trim() || selectedTypes.length === 0}
              className="btn"
              style={{ flex: 1, padding: 14 }}
            >
              {isGenerating ? 'Generating...' : 'Generate Single'}
            </button>
            <button 
              onClick={saveToLibrary}
              className="btn-secondary"
              style={{ flex: 1 }}
              disabled={!prompt.trim()}
            >
              Save to Library
            </button>
          </div>
        </div>
      )}

      {/* ==================== HISTORY TAB ==================== */}
      {activeTab === 'History' && (
        <div>
          {history.length === 0 ? (
            <p style={{ textAlign: 'center', opacity: 0.6, padding: 40 }}>No history yet. Generate some tests first.</p>
          ) : (
            history.map((entry: any) => (
              <div key={entry.id} className="result-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 13, opacity: 0.6 }}>
                    {new Date(entry.timestamp).toLocaleDateString()}
                  </span>
                  <div>
                    <button onClick={() => togglePin(entry.id)} style={{ marginRight: 8 }}>
                      {entry.pinned ? '★' : '☆'}
                    </button>
                    <button onClick={() => deleteHistoryItem(entry.id)}>🗑</button>
                  </div>
                </div>
                
                <div style={{ marginBottom: 12, fontWeight: 500, lineHeight: 1.4 }}>
                  {entry.prompt.length > 85 ? entry.prompt.substring(0, 85) + '...' : entry.prompt}
                </div>

                <button 
                  onClick={() => { 
                    setResults(entry)
                    setActiveTab('Generate')
                  }}
                  style={{ width: '100%' }}
                >
                  View Results
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* ==================== LIBRARY TAB ==================== */}
      {activeTab === 'Library' && (
        <div>
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>Saved Prompts ({library.length})</h3>
            <span style={{ fontSize: 13, opacity: 0.6 }}>Max 50 for Pro</span>
          </div>

          {library.length === 0 ? (
            <p style={{ textAlign: 'center', opacity: 0.6, padding: 40 }}>Library is empty. Save prompts from Generate tab.</p>
          ) : (
            library.map((item: any) => (
              <div key={item.id} className="result-card">
                <div style={{ marginBottom: 12, lineHeight: 1.5 }}>
                  {item.prompt.length > 110 ? item.prompt.substring(0, 110) + '...' : item.prompt}
                </div>
                <button 
                  onClick={() => useLibraryPrompt(item.prompt)}
                  style={{ width: '100%' }}
                >
                  Load into Generator
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* ==================== BATCH TAB ==================== */}
      {activeTab === 'Batch' && (
        <div>
          <h3>Batch Mode</h3>
          <p style={{ fontSize: 13, opacity: 0.7, marginBottom: 16 }}>
            Process multiple prompts with the same perturbation types
          </p>

          {batchPrompts.map((p, index) => (
            <div key={index} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <textarea 
                value={p} 
                onChange={(e) => updateBatchPrompt(index, e.target.value)}
                placeholder={`Prompt ${index + 1}`}
                rows={3}
                style={{ flex: 1, padding: 12, borderRadius: 10 }}
              />
              {batchPrompts.length > 1 && (
                <button 
                  onClick={() => removeBatchRow(index)}
                  style={{ alignSelf: 'flex-start', padding: '8px 12px' }}
                >
                  ×
                </button>
              )}
            </div>
          ))}

          <button onClick={addBatchRow} className="btn-secondary" style={{ width: '100%', marginBottom: 20 }}>
            + Add Another Prompt
          </button>

          <div className="section">
            <h4>Select Perturbation Types (applied to all prompts)</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {[...FREE_TYPES, ...PRO_TYPES].map(type => (
                <div 
                  key={type}
                  onClick={() => toggleType(type)}
                  className={`pill ${selectedTypes.includes(type) ? 'active' : ''}`}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 9999,
                    cursor: 'pointer',
                    fontSize: 13,
                    background: selectedTypes.includes(type) ? 'var(--accent)' : 'var(--bg)',
                    color: selectedTypes.includes(type) ? '#0f172a' : 'var(--text)'
                  }}
                >
                  {type}
                </div>
              ))}
            </div>
          </div>

          <button 
            onClick={runBatch} 
            disabled={isGenerating || batchPrompts.every(p => !p.trim()) || selectedTypes.length === 0}
            className="btn"
            style={{ width: '100%', padding: 14, marginTop: 8 }}
          >
            {isGenerating ? 'Running Batch...' : `Run Batch (${batchPrompts.filter(p => p.trim()).length} prompts)`}
          </button>
        </div>
      )}

      {/* Results Display (shown in Generate tab after generation) */}
      {results && activeTab === 'Generate' && (
        <div style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3>Results {results.isBatch && `(${results.count} prompts)`}</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => exportResults('txt')} className="btn-secondary">TXT</button>
              <button onClick={() => exportResults('csv')} className="btn-secondary">CSV</button>
            </div>
          </div>

          {results.results.map((r: any, index: number) => (
            <div key={index} className="result-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <strong style={{ color: 'var(--accent)' }}>{r.type}</strong>
                <span>{r.similarity}% similar</span>
              </div>
              <div className="diff" style={{ marginBottom: 12 }}>
                {r.perturbed}
              </div>
              <button 
                onClick={() => copyToClipboard(r.perturbed)}
                style={{ width: '100%' }}
              >
                Copy Perturbed Prompt
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Status Message */}
      {status && (
        <div style={{ 
          marginTop: 16, 
          padding: 12, 
          background: status.includes('success') || status.includes('completed') ? '#22c55e20' : '#f59e0b20',
          color: status.includes('success') || status.includes('completed') ? '#22c55e' : '#f59e0b',
          borderRadius: 8,
          textAlign: 'center',
          fontSize: 14
        }}>
          {status}
        </div>
      )}

      {/* License / Footer */}
      <div style={{ marginTop: 'auto', paddingTop: 20, borderTop: '1px solid var(--border)', fontSize: 13 }}>
        {!daily.isPro && (
          <div>
            <input 
              value={licenseKey} 
              onChange={(e) => setLicenseKey(e.target.value)}
              placeholder="Enter Gumroad License Key"
              style={{ width: '100%', padding: 10, marginBottom: 8, borderRadius: 8 }}
            />
            <button 
              onClick={async () => {
                const res = await chrome.runtime.sendMessage({ 
                  action: 'verifyLicense', 
                  key: licenseKey 
                })
                if (res.valid) {
                  setStatus('✓ Pro license activated! Unlimited tests enabled.')
                } else {
                  setStatus('Invalid license key. Please check and try again.')
                }
              }}
              className="btn"
              style={{ width: '100%' }}
            >
              Activate Pro Version
            </button>
            <div style={{ textAlign: 'center', marginTop: 12, opacity: 0.6, fontSize: 12 }}>
              Pro unlocks unlimited tests, 30-day history, and 50 library items
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
