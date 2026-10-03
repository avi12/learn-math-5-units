import { mount } from 'svelte';
import '@learn-math/shared/skin/cyberpunk.css';
import '@learn-math/shared/skin/hebrew.css';
import './lib/app.css';
import './lib/controls.css';
import 'temml/dist/Temml-Latin-Modern.css';
import App from './App.svelte';

export default mount(App, { target: document.getElementById('app')! });
