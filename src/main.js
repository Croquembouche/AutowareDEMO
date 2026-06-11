import './style.css';
import { Viewer } from './viewer.js';
import { TimelineController } from './timeline.js';

const viewerElement = document.querySelector('#viewer');
const viewer = new Viewer(viewerElement, {
  loadingStatus: document.querySelector('#loadingStatus'),
  cameraBadge: document.querySelector('#cameraBadge'),
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
  syncFrameCount: document.querySelector('#syncFrameCount'),
  objectFrameCount: document.querySelector('#objectFrameCount'),
  cameraCount: document.querySelector('#cameraCount'),
  activeEgoFrame: document.querySelector('#activeEgoFrame'),
  activeObjectFrame: document.querySelector('#activeObjectFrame'),
  cameraPanel: document.querySelector('#cameraPanel'),
  lidarPanel: document.querySelector('#lidarPanel'),
  cameraTabs: document.querySelector('#cameraTabs'),
  cameraStage: document.querySelector('#cameraStage'),
  cameraImage: document.querySelector('#cameraImage'),
  cameraOverlay: document.querySelector('#cameraOverlay'),
  activeCameraName: document.querySelector('#activeCameraName'),
  activeCameraFrame: document.querySelector('#activeCameraFrame'),
  lidarCanvas: document.querySelector('#lidarCanvas'),
  lidarFrameCount: document.querySelector('#lidarFrameCount'),
  activeLidarFrame: document.querySelector('#activeLidarFrame'),
  activeLidarPoints: document.querySelector('#activeLidarPoints'),
  viewModeButtons: document.querySelectorAll('[data-view-mode]')
});

const timeline = new TimelineController(viewer, {
  stateButtons: document.querySelectorAll('[data-state]'),
  layerInputs: document.querySelectorAll('[data-layer]'),
  groupInputs: document.querySelectorAll('[data-layer-group]'),
  actionButtons: document.querySelectorAll('[data-action]'),
  frameButtons: document.querySelectorAll('[data-frame]'),
  timelineScrubber: document.querySelector('#timelineScrubber'),
  moduleNodes: document.querySelectorAll('[data-module]'),
  topicRows: document.querySelectorAll('[data-topic]'),
  walkthroughItems: document.querySelectorAll('[data-walkthrough]')
});

viewer.load().then(() => {
  timeline.initialize();
});
