import './style.css';
import { Viewer } from './viewer.js';
import { TimelineController } from './timeline.js';

const viewerElement = document.querySelector('#viewer');
const viewer = new Viewer(viewerElement, {
  loadingStatus: document.querySelector('#loadingStatus'),
  stateStatus: document.querySelector('#stateStatus'),
  detailStatus: document.querySelector('#detailStatus'),
  timelineScrubber: document.querySelector('#timelineScrubber'),
  operationMode: document.querySelector('#operationMode'),
  routeState: document.querySelector('#routeState'),
  localizationState: document.querySelector('#localizationState'),
  controlMode: document.querySelector('#controlMode'),
  simTime: document.querySelector('#simTime'),
  speedValue: document.querySelector('#speedValue'),
  steerValue: document.querySelector('#steerValue'),
  datasetName: document.querySelector('#datasetName'),
  datasetLog: document.querySelector('#datasetLog'),
  pointCount: document.querySelector('#pointCount'),
  laneletCount: document.querySelector('#laneletCount'),
  syncFrameCount: document.querySelector('#syncFrameCount')
});

const timeline = new TimelineController(viewer, {
  stateButtons: document.querySelectorAll('[data-state]'),
  layerInputs: document.querySelectorAll('[data-layer]'),
  actionButtons: document.querySelectorAll('[data-action]'),
  frameButtons: document.querySelectorAll('[data-frame]'),
  timelineScrubber: document.querySelector('#timelineScrubber'),
  moduleNodes: document.querySelectorAll('[data-module]'),
  walkthroughItems: document.querySelectorAll('[data-walkthrough]')
});

viewer.load().then(() => {
  timeline.initialize();
});
