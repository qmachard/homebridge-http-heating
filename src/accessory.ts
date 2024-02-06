import { PlatformAccessory, Service } from 'homebridge';

import { HomebridgePlatform } from './platform';

export type PlanningState = 'HEAT' | 'OFF';
export type PlanningItem = { start_time: string; end_time: string; state: PlanningState };
export type Planning = PlanningItem[];

// TEST FUNCTION
let currentHour = 0;
function getCurrentTime(): string {
  currentHour = (currentHour + 1) % 24;

  if (currentHour < 10) {
    return `0${currentHour}:00`;
  }

  return `${currentHour}:00`;
}

export class HeatingAccessory {
  private service: Service;

  private currentState: number = this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
  private targetState: number = this.platform.Characteristic.TargetHeatingCoolingState.AUTO;

  constructor(
    private readonly platform: HomebridgePlatform,
    private readonly accessory: PlatformAccessory,
    private readonly config: { planning?: Planning },
  ) {
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Homebridge')
      .setCharacteristic(this.platform.Characteristic.Model, 'HttpHeating')
      .setCharacteristic(this.platform.Characteristic.Version, '1.0.0');

    this.service = this.accessory.getService(this.platform.Service.Thermostat)
      || this.accessory.addService(this.platform.Service.Thermostat);

    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .setProps({
        minValue: 19,
        maxValue: 19,
      });

    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(() => this.getCurrentTemperature());

    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .setProps({
        validValues: [
          this.platform.Characteristic.TargetHeatingCoolingState.OFF,
          this.platform.Characteristic.TargetHeatingCoolingState.HEAT,
          this.platform.Characteristic.TargetHeatingCoolingState.AUTO,
        ],
      })
      .onGet(() => this.targetState)
      .onSet((value) => {
        this.targetState = value as number;

        this.refreshCurrentState();
      });

    this.refreshCurrentState();
    setInterval(() => {
      this.refreshCurrentState();
    }, 5000);
  }

  private getPlannedState(): number {
    const currentTime = getCurrentTime();

    const headerPlanner = this.config.planning?.find((planner) => {
      if (planner.start_time <= planner.end_time) {
        return planner.start_time <= currentTime && currentTime < planner.end_time;
      } else {
        return planner.start_time <= currentTime && currentTime <= '23:59' || currentTime < planner.end_time && currentTime >= '00:00';
      }
    });

    if (headerPlanner?.state === 'HEAT') {
      return this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
    }

    return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
  }

  private getCurrentState(): number {
    const plannedState = this.getPlannedState();

    if (this.targetState === this.platform.Characteristic.CurrentHeatingCoolingState.OFF) {
      return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
    }

    if (this.targetState === this.platform.Characteristic.CurrentHeatingCoolingState.HEAT) {
      return this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
    }

    return plannedState;
  }

  private getCurrentTemperature(): number {
    if (this.currentState === this.platform.Characteristic.CurrentHeatingCoolingState.HEAT) {
      return 19;
    }

    return 15.5;
  }

  private refreshCurrentState(): void {
    this.currentState = this.getCurrentState();

    this.platform.log.debug('Refresh current state', this.currentState, this.targetState);

    this.service.setCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, this.currentState);
    this.service.setCharacteristic(this.platform.Characteristic.CurrentTemperature, this.getCurrentTemperature());
    this.service.setCharacteristic(this.platform.Characteristic.TargetTemperature, 19);
  }
}
