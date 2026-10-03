import { mount } from 'svelte';
import './lib/cyberpunk.css';
import './lib/app.css';
import './lib/controls.css';
import 'temml/dist/Temml-Latin-Modern.css';
import App from './App.svelte';

export default mount(App, { target: document.getElementById('app')! });
