// Entry point. Importing components-element auto-registers the
// <audit-trail> custom element; the side-effecting CSS import wires
// the default styles.
import '@everscribe/components-element'
import '@everscribe/components-styles/default.css'
import './styles.css'
import { mountApp } from './app.js'

mountApp(document.getElementById('root')!)
