import './style.css';
import { Viewer } from './viewer.js';
import { TimelineController } from './timeline.js';

const viewerElement = document.querySelector('#viewer');
const viewer = new Viewer(viewerElement, {
  loadingStatus: document.querySelector('#loadingStatus'),
  stateStatus: document.querySelector('#stateStatus'),
  detailStatus: document.querySelector('#detailStatus'),
  timelineScrubber: document.querySelector('#timelineScrubber')
});

const timeline = new TimelineController(viewer, {
  stateButtons: document.querySelectorAll('[data-state]'),
  layerInputs: document.querySelectorAll('[data-layer]'),
  actionButtons: document.querySelectorAll('[data-action]'),
  frameButtons: document.querySelectorAll('[data-frame]'),
  timelineScrubber: document.querySelector('#timelineScrubber')
});

viewer.load().then(() => {
  timeline.initialize();
});
