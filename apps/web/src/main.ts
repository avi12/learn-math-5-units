import { mount } from 'svelte';
import './lib/cyberpunk.css';
import './lib/app.css';
import App from './App.svelte';

export default mount(App, { target: document.getElementById('app')! });
