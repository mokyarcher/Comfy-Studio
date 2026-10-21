import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { GenerateProgressEvent } from '../shared/types'

const api = {
  authRegister: (input: unknown) => ipcRenderer.invoke('studio:authRegister', input),
  authLogin: (input: unknown) => ipcRenderer.invoke('studio:authLogin', input),
  logout: () => ipcRenderer.invoke('studio:logout'),
  changePassword: (input: unknown) => ipcRenderer.invoke('studio:changePassword', input),

  getProfiles: () => ipcRenderer.invoke('studio:getProfiles'),
  listProfiles: () => ipcRenderer.invoke('studio:getProfiles'),
  saveProfile: (input: unknown) => ipcRenderer.invoke('studio:saveProfile', input),
  deleteProfile: (id: string) => ipcRenderer.invoke('studio:deleteProfile', id),
  setActiveProfile: (id: string) => ipcRenderer.invoke('studio:setActiveProfile', id),
  setDefaultProfile: (id: string) => ipcRenderer.invoke('studio:setActiveProfile', id),
  testConnection: (input: unknown) => ipcRenderer.invoke('studio:testConnection', input),
  getGpuStatus: (input: unknown) => ipcRenderer.invoke('studio:getGpuStatus', input),

  generateImage: (input: unknown) => ipcRenderer.invoke('studio:generateImage', input),
  uploadImage: (input: unknown) => ipcRenderer.invoke('studio:uploadImage', input),
  generate: (input: unknown) => ipcRenderer.invoke('api:generate', input),
  pollTask: (input: unknown) => ipcRenderer.invoke('api:pollTask', input),
  fetchImage: (input: unknown) => ipcRenderer.invoke('api:fetchImage', input),

  onGenerateProgress: (handler: (event: GenerateProgressEvent) => void) => {
    const listener = (_: IpcRendererEvent, payload: GenerateProgressEvent) => handler(payload)
    ipcRenderer.on('studio:generateProgress', listener)
    return () => {
      ipcRenderer.removeListener('studio:generateProgress', listener)
    }
  },

  getGallery: () => ipcRenderer.invoke('studio:getGallery'),
  listGallery: () => ipcRenderer.invoke('studio:getGallery'),
  deleteGalleryItem: (id: string) => ipcRenderer.invoke('studio:deleteGalleryItem', id),
  toggleFavorite: (id: string, favorite: boolean) =>
    ipcRenderer.invoke('gallery:toggleFavorite', { id, favorite }),
  exportImage: (id: string) => ipcRenderer.invoke('studio:exportImage', id),
  openInFolder: (id: string) => ipcRenderer.invoke('studio:openInFolder', id),
  openGalleryFile: (id: string) => ipcRenderer.invoke('gallery:openFile', id),
  readGalleryDataUrl: (id: string) => ipcRenderer.invoke('gallery:readDataUrl', id),
  getGalleryMediaUrl: (id: string) => ipcRenderer.invoke('gallery:getMediaUrl', id),
  saveImageFromDataUrl: (input: unknown) => ipcRenderer.invoke('gallery:saveFromDataUrl', input),
  clearGallery: () => ipcRenderer.invoke('studio:clearGallery'),
  openGalleryFolder: () => ipcRenderer.invoke('studio:openGalleryFolder'),

  listShowcase: (input: unknown) => ipcRenderer.invoke('studio:listShowcase', input),
  shareGalleryToShowcase: (input: unknown) =>
    ipcRenderer.invoke('studio:shareGalleryToShowcase', input),
  unlistShowcase: (input: unknown) => ipcRenderer.invoke('studio:unlistShowcase', input),
  toggleShowcaseLike: (input: unknown) => ipcRenderer.invoke('studio:toggleShowcaseLike', input),
  toggleShowcaseFavorite: (input: unknown) =>
    ipcRenderer.invoke('studio:toggleShowcaseFavorite', input),
  listShowcaseComments: (input: unknown) =>
    ipcRenderer.invoke('studio:listShowcaseComments', input),
  addShowcaseComment: (input: unknown) => ipcRenderer.invoke('studio:addShowcaseComment', input),
  deleteShowcaseComment: (input: unknown) =>
    ipcRenderer.invoke('studio:deleteShowcaseComment', input),
  fetchShowcaseAsset: (input: unknown) => ipcRenderer.invoke('studio:fetchShowcaseAsset', input),
  downloadShowcaseImage: (input: unknown) =>
    ipcRenderer.invoke('studio:downloadShowcaseImage', input),

  getSettings: () => ipcRenderer.invoke('studio:getSettings'),
  saveSettings: (input: unknown) => ipcRenderer.invoke('studio:saveSettings', input),

  polishAi: (input: unknown) => ipcRenderer.invoke('polish:ai', input),
  translatePrompt: (input: unknown) => ipcRenderer.invoke('polish:translate', input),
  getAiPolishSettings: () => ipcRenderer.invoke('polish:getAiSettings'),
  saveAiPolishSettings: (input: unknown) => ipcRenderer.invoke('polish:saveAiSettings', input),
  testAiPolish: () => ipcRenderer.invoke('polish:testAi'),

  listTaskHistory: () => ipcRenderer.invoke('tasks:listHistory'),
  saveTaskHistory: (tasks: unknown) => ipcRenderer.invoke('tasks:saveHistory', tasks),
  clearTaskHistory: () => ipcRenderer.invoke('tasks:clearHistory'),

  listPrompts: () => ipcRenderer.invoke('prompts:list'),
  saveTemplate: (input: unknown) => ipcRenderer.invoke('prompts:saveTemplate', input),
  deleteTemplate: (id: string) => ipcRenderer.invoke('prompts:deleteTemplate', id),
  savePhrase: (input: unknown) => ipcRenderer.invoke('prompts:savePhrase', input),
  deletePhrase: (id: string) => ipcRenderer.invoke('prompts:deletePhrase', id),
  listOfficialPrompts: () => ipcRenderer.invoke('prompts:listOfficial'),
  refreshOfficialPrompts: (input: unknown) => ipcRenderer.invoke('prompts:refreshOfficial', input),
  checkOfficialUpdate: (input: unknown) => ipcRenderer.invoke('prompts:checkOfficialUpdate', input),
  listSharedPrompts: (input: unknown) => ipcRenderer.invoke('prompts:listShared', input),
  shareToSharedLibrary: (input: unknown) => ipcRenderer.invoke('prompts:shareToShared', input),
  deleteSharedPrompt: (input: unknown) => ipcRenderer.invoke('prompts:deleteShared', input),

  windowMinimize: () => ipcRenderer.invoke('studio:windowMinimize'),
  windowMaximize: () => ipcRenderer.invoke('studio:windowMaximize'),
  windowClose: () => ipcRenderer.invoke('studio:windowClose'),
  windowIsMaximized: () => ipcRenderer.invoke('studio:windowIsMaximized')
}

contextBridge.exposeInMainWorld('studio', api)

export type StudioApi = typeof api
