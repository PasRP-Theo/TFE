import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App.tsx'

const DEV_SW_CLEANUP_FLAG = 'sentys:dev-sw-cleanup'

async function prepareRuntime() {
    if (import.meta.env.DEV && 'serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations()
        await Promise.all(registrations.map((registration) => registration.unregister()))

        if (navigator.serviceWorker.controller && !sessionStorage.getItem(DEV_SW_CLEANUP_FLAG)) {
            sessionStorage.setItem(DEV_SW_CLEANUP_FLAG, '1')
            window.location.reload()
            return false
        }

        sessionStorage.removeItem(DEV_SW_CLEANUP_FLAG)
    }

    return true
}

if (!import.meta.env.DEV) {
    registerSW({ immediate: true })
}

void prepareRuntime().then((shouldRender) => {
    if (!shouldRender) return

    ReactDOM.createRoot(document.getElementById('root')!).render(
        <React.StrictMode>
            <BrowserRouter>
                <App />
            </BrowserRouter>
        </React.StrictMode>,
    )
})