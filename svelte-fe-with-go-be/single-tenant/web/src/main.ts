// Entry point. Importing components-element auto-registers <audit-trail>
// as a custom element; Svelte renders it like any other tag.
import '@everscribe/components-element'
import '@everscribe/components-styles/default.css'
import './styles.css'
import { mount } from 'svelte'
import App from './App.svelte'

mount(App, { target: document.getElementById('root')! })
