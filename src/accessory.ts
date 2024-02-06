import { PlatformAccessory, Service } from 'homebridge';
import dayjs from 'dayjs';
import * as http from 'http';
import jsonpath from 'jsonpath';

import { HomebridgePlatform } from './platform';

export type HeatingAccessoryConfig = {
  planning?: Planning;
  temperatures?: {
    off: number;
    heat: number;
  };
  http: {
    heat_url: string;
    off_url: string;
    status_url: string;
    status_path: string;
    status_value: string;
  };
};

export type PlanningHeat = { start_time: string; end_time: string };
export type PlanningDay = PlanningHeat[];
export type Planning = PlanningDay[];

function getCurrentDay(): number {
  return dayjs().day();
}

function getCurrentTime(): string {
  return dayjs().format('HH:mm');
}

export class HeatingAccessory {
  private service: Service;

  private currentState: number = this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
  private targetState: number = this.platform.Characteristic.TargetHeatingCoolingState.AUTO;

  constructor(
    private readonly platform: HomebridgePlatform,
    private readonly accessory: PlatformAccessory,
    private readonly config: HeatingAccessoryConfig,
  ) {
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Homebridge')
      .setCharacteristic(this.platform.Characteristic.Model, 'HttpHeating')
      .setCharacteristic(this.platform.Characteristic.Version, '1.0.0');

    this.service = this.accessory.getService(this.platform.Service.Thermostat)
      || this.accessory.addService(this.platform.Service.Thermostat);

    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .setProps({
        minValue: this.config.temperatures?.heat ?? 19,
        maxValue: this.config.temperatures?.heat ?? 19,
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

    this.pollStatus();

    setInterval(() => {
      this.pollStatus();
    }, 60 * 1000);
  }

  private getPlannedState(): number {
    const currentDay = getCurrentDay();
    const currentTime = getCurrentTime();

    const mustHeat = this.config.planning?.[currentDay]?.some(planningHeat => {
      if (planningHeat.start_time <= planningHeat.end_time) {
        return planningHeat.start_time <= currentTime && currentTime < planningHeat.end_time;
      }

      return planningHeat.start_time <= currentTime && currentTime <= '23:59'
        || currentTime < planningHeat.end_time && currentTime >= '00:00';
    });

    if (mustHeat) {
      return this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
    }

    return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
  }

  private getExpectedState(): number {
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
      return this.config.temperatures?.heat ?? 19;
    }

    return this.config.temperatures?.off ?? 15;
  }

  private pollStatus(): void {
    this.platform.log.debug('Polling status...');

    http.get(this.config.http.status_url, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        const json = JSON.parse(data);

        const status = jsonpath.query(json, this.config.http.status_path).some((value) => {
          return value === this.config.http.status_value;
        }) as boolean;

        this.currentState = status
          ? this.platform.Characteristic.CurrentHeatingCoolingState.HEAT
          : this.platform.Characteristic.CurrentHeatingCoolingState.OFF;

        this.refreshCurrentState();
      });

      res.on('error', (error) => {
        this.platform.log.error('Polling status failed', error);
      });
    });
  }

  private async postStatus() {
    this.platform.log.debug('Post status');

    return new Promise<void>((resolve, reject) => {
      http.get(this.currentState === this.platform.Characteristic.CurrentHeatingCoolingState.HEAT
        ? this.config.http.heat_url
        : this.config.http.off_url, (res) => {
        res.on('end', () => {
          resolve();
        });

        res.on('error', (error) => {
          reject(error);
        });
      });
    });
  }

  private refreshCurrentState(): void {
    const expectedState = this.getExpectedState();

    if (this.currentState !== expectedState) {
      this.currentState = expectedState;

      this.postStatus().then(() => {
        this.platform.log.debug('Post status success');
      }).catch((error) => {
        this.platform.log.error('Post status error', error);
      });
    }

    this.platform.log.debug('Refresh current state', this.currentState, this.targetState);

    this.service.setCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, this.currentState);
    this.service.setCharacteristic(this.platform.Characteristic.CurrentTemperature, this.getCurrentTemperature());
    this.service.setCharacteristic(this.platform.Characteristic.TargetTemperature, this.config.temperatures?.heat ?? 19);
  }
}
