import { useState, useCallback } from 'react'

export interface Project {
  id: string    // UUID — used as app_project_id in all API calls
  name: string
  createdAt: string
}

const STORAGE_KEY = 'groundmodel_project'

function loadFromStorage(): Project | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Project) : null
  } catch {
    return null
  }
}

function saveToStorage(project: Project): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(project))
}

function removeFromStorage(): void {
  localStorage.removeItem(STORAGE_KEY)
}

function generateId(): string {
  // crypto.randomUUID() is available in Electron's renderer (Chromium)
  return crypto.randomUUID()
}

export function useProject() {
  const [project, setProject] = useState<Project | null>(loadFromStorage)

  const createProject = useCallback((name: string): Project => {
    const p: Project = { id: generateId(), name, createdAt: new Date().toISOString() }
    saveToStorage(p)
    setProject(p)
    return p
  }, [])

  const closeProject = useCallback(() => {
    removeFromStorage()
    setProject(null)
  }, [])

  return { project, createProject, closeProject }
}
