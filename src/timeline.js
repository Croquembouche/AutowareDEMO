const stateVisibility = {
  initial: {
    pointCloud: true,
    laneBoundaries: true,
    centerlines: true,
    crosswalks: true,
    stopLines: true,
    trafficLights: true,
    route: false,
    egoVehicle: true,
    trajectoryTrail: false,
    predictedPath: false,
    perceptionObjects: false
  },
  planning: {
    pointCloud: true,
    laneBoundaries: true,
    centerlines: true,
    crosswalks: true,
    stopLines: true,
    trafficLights: true,
    route: true,
    egoVehicle: true,
    trajectoryTrail: true,
    predictedPath: true,
    perceptionObjects: false
  },
  perception: {
    pointCloud: true,
    laneBoundaries: true,
    centerlines: true,
    crosswalks: true,
    stopLines: true,
    trafficLights: true,
    route: true,
    egoVehicle: true,
    trajectoryTrail: true,
    predictedPath: true,
    perceptionObjects: true
  },
  drive: {
    pointCloud: true,
    laneBoundaries: true,
    centerlines: true,
    crosswalks: true,
    stopLines: true,
    trafficLights: true,
    route: true,
    egoVehicle: true,
    trajectoryTrail: true,
    predictedPath: true,
    perceptionObjects: true
  },
  goal: {
    pointCloud: true,
    laneBoundaries: true,
    centerlines: true,
    crosswalks: true,
    stopLines: true,
    trafficLights: true,
    route: true,
    egoVehicle: true,
    trajectoryTrail: true,
    predictedPath: false,
    perceptionObjects: true
  }
};

const stateCopy = {
  initial: ['WAITING_FOR_ROUTE', 'Map and localization displays are active: PointCloudMap, Lanelet2VectorMap, and the ego pose in the map frame.'],
  planning: ['PLANNING', 'A fixed goal has been set. Route, Trajectory, and PathWithLaneId represent pre-authored planning outputs.'],
  perception: ['WAITING_FOR_ENGAGE', 'PredictedObjects are loaded from a static AV2 annotation frame and overlaid near the ego route.'],
  drive: ['DRIVING', 'The scripted control phase consumes the fixed trajectory while perception frames advance with playback time.'],
  goal: ['ARRIVED_GOAL', 'The ego vehicle is stopped at the final pre-authored waypoint with final route and object evidence visible.']
};

const panelStatus = {
  initial: { operationMode: 'STOP', routeState: 'UNSET', controlMode: 'MANUAL' },
  planning: { operationMode: 'STOP', routeState: 'SET', controlMode: 'MANUAL' },
  perception: { operationMode: 'STOP', routeState: 'SET', controlMode: 'MANUAL' },
  drive: { operationMode: 'AUTONOMOUS', routeState: 'SET', controlMode: 'AUTO' },
  goal: { operationMode: 'STOP', routeState: 'ARRIVED', controlMode: 'AUTO' }
};

const activeModulesByState = {
  initial: ['map', 'localization', 'vehicle'],
  planning: ['map', 'localization', 'planning', 'vehicle'],
  perception: ['map', 'localization', 'perception', 'planning', 'vehicle'],
  drive: ['map', 'localization', 'perception', 'planning', 'control', 'vehicle'],
  goal: ['map', 'localization', 'perception', 'planning', 'control', 'vehicle']
};

const layerGroups = {
  autoware: [
    'egoVehicle',
    'pointCloud',
    'laneBoundaries',
    'centerlines',
    'crosswalks',
    'stopLines',
    'trafficLights',
    'route',
    'trajectoryTrail',
    'predictedPath',
    'perceptionObjects'
  ],
  system: ['egoVehicle'],
  map: ['pointCloud', 'laneBoundaries', 'centerlines', 'crosswalks', 'stopLines', 'trafficLights'],
  planning: ['route', 'trajectoryTrail', 'predictedPath'],
  perception: ['perceptionObjects']
};

export class TimelineController {
  constructor(viewer, elements) {
    this.viewer = viewer;
    this.elements = elements;
  }

  initialize() {
    this.elements.stateButtons.forEach((button) => {
      button.addEventListener('click', () => this.applyState(button.dataset.state));
    });

    this.elements.layerInputs.forEach((input) => {
      input.addEventListener('change', () => {
        this.viewer.setLayerVisible(input.dataset.layer, input.checked);
        this.updateGroupInputs();
      });
    });

    this.elements.groupInputs.forEach((input) => {
      input.addEventListener('click', (event) => event.stopPropagation());
      input.addEventListener('change', () => this.setLayerGroup(input.dataset.layerGroup, input.checked));
    });

    this.elements.actionButtons.forEach((button) => {
      button.addEventListener('click', () => this.handleAction(button.dataset.action));
    });

    this.elements.frameButtons.forEach((button) => {
      button.addEventListener('click', () => {
        this.viewer.setLayerVisible('perceptionObjects', true);
        this.setLayerInput('perceptionObjects', true);
        this.viewer.setPerceptionFrame(Number(button.dataset.frame));
        this.updateGroupInputs();
      });
    });

    this.elements.timelineScrubber.addEventListener('input', (event) => {
      this.viewer.setEgoProgress(Number(event.target.value) / 100);
    });

    this.applyState('initial', false);
  }

  applyState(name, moveCamera = true) {
    const visibility = stateVisibility[name];
    if (!visibility) {
      return;
    }

    this.viewer.pauseEgo();
    this.viewer.setLayers(visibility);
    Object.entries(visibility).forEach(([layer, visible]) => this.setLayerInput(layer, visible));
    this.updateGroupInputs();
    this.setActiveState(name);

    if (name === 'initial') {
      this.viewer.resetEgo();
      this.viewer.setPerceptionFrame(0);
    }
    if (name === 'perception') {
      this.viewer.setPerceptionFrame(0);
    }
    if (name === 'drive') {
      this.viewer.setPerceptionFrame(1);
      this.viewer.playEgo();
    }
    if (name === 'goal') {
      this.viewer.setEgoGoal();
      this.viewer.setPerceptionFrame(2);
    }

    this.viewer.setStateText(...stateCopy[name]);
    this.viewer.setPanelStatus(panelStatus[name]);
    this.setActiveModules(name);
    this.setActiveTopics(name);
    this.setActiveWalkthrough(name);
    this.viewer.setCameraPreset(name, moveCamera);
  }

  handleAction(action) {
    if (action === 'play') {
      this.applyState('drive');
      return;
    }
    if (action === 'pause') {
      this.viewer.pauseEgo();
      this.viewer.setDetail('Playback paused at the current scripted trajectory time.');
      return;
    }
    if (action === 'resetPlayback') {
      this.viewer.resetEgo();
      this.viewer.setDetail('Ego trajectory reset to the first pre-authored waypoint.');
      return;
    }
    if (action === 'resetCamera') {
      this.viewer.setCameraPreset('initial');
      return;
    }
    if (action === 'topDown') {
      this.viewer.setCameraPreset('topDown');
    }
  }

  setLayerInput(layer, visible) {
    const input = Array.from(this.elements.layerInputs).find((item) => item.dataset.layer === layer);
    if (input) {
      input.checked = visible;
    }
  }

  setLayerGroup(groupName, visible) {
    const layers = layerGroups[groupName] ?? [];
    layers.forEach((layer) => {
      this.viewer.setLayerVisible(layer, visible);
      this.setLayerInput(layer, visible);
    });
    this.updateGroupInputs();
  }

  updateGroupInputs() {
    this.elements.groupInputs.forEach((input) => {
      const layers = layerGroups[input.dataset.layerGroup] ?? [];
      const layerInputs = layers
        .map((layer) => Array.from(this.elements.layerInputs).find((item) => item.dataset.layer === layer))
        .filter(Boolean);

      const checkedCount = layerInputs.filter((item) => item.checked).length;
      input.checked = layerInputs.length > 0 && checkedCount === layerInputs.length;
      input.indeterminate = checkedCount > 0 && checkedCount < layerInputs.length;
    });
  }

  setActiveState(name) {
    this.elements.stateButtons.forEach((button) => {
      button.classList.toggle('active', button.dataset.state === name);
    });
  }

  setActiveModules(name) {
    const activeModules = new Set(activeModulesByState[name] ?? []);
    this.elements.moduleNodes.forEach((node) => {
      node.classList.toggle('active', activeModules.has(node.dataset.module));
    });
  }

  setActiveTopics(name) {
    const activeTopics = new Set(activeModulesByState[name] ?? []);
    this.elements.topicRows.forEach((row) => {
      row.classList.toggle('active', activeTopics.has(row.dataset.topic));
    });
  }

  setActiveWalkthrough(name) {
    this.elements.walkthroughItems.forEach((item) => {
      item.classList.toggle('active', item.dataset.walkthrough === name);
    });
  }
}
