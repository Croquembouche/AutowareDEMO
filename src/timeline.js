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
    trajectoryTrail: true,
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
  initial: ['Initial Map', 'Point Cloud Map and Lanelet Map layers are visible. All data is pre-authored static content.'],
  planning: ['Planning', 'Fixed route and predicted path are visible. No planner is running in the browser.'],
  perception: ['Perception', 'Showing predefined detected object boxes from Perception Frame 1.'],
  drive: ['Autonomous Drive', 'Playing the scripted ego trajectory with deterministic interpolation.'],
  goal: ['Goal Reached', 'The ego vehicle is parked at the final pre-authored waypoint.']
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
      });
    });

    this.elements.actionButtons.forEach((button) => {
      button.addEventListener('click', () => this.handleAction(button.dataset.action));
    });

    this.elements.frameButtons.forEach((button) => {
      button.addEventListener('click', () => {
        this.viewer.setLayerVisible('perceptionObjects', true);
        this.setLayerInput('perceptionObjects', true);
        this.viewer.setPerceptionFrame(Number(button.dataset.frame));
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
    this.setActiveState(name);

    if (name === 'initial') {
      this.viewer.resetEgo();
      this.viewer.setPerceptionFrame(0);
    }
    if (name === 'perception') {
      this.viewer.setPerceptionFrame(0);
    }
    if (name === 'drive') {
      this.viewer.playEgo();
      this.viewer.setPerceptionFrame(1);
    }
    if (name === 'goal') {
      this.viewer.setEgoGoal();
      this.viewer.setPerceptionFrame(2);
    }

    this.viewer.setStateText(...stateCopy[name]);
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

  setActiveState(name) {
    this.elements.stateButtons.forEach((button) => {
      button.classList.toggle('active', button.dataset.state === name);
    });
  }
}
