import React, { createContext, useCallback, useContext, useMemo } from "react";

import type { DeviceDisplayConfig, DeviceStyle } from "../types/types";
import { getDeviceDisplayName, getDeviceStyle } from "../utils";

export type DeviceConfigContextValue = {
  deviceConfigs: DeviceDisplayConfig[] | undefined;
  getDeviceStyle: (deviceName?: string) => DeviceStyle;
  getDeviceDisplayName: (deviceName: string) => string;
};

const DeviceConfigContext = createContext<DeviceConfigContextValue | null>(null);

export const DeviceConfigProvider = ({
  deviceConfigs,
  children,
}: {
  deviceConfigs?: DeviceDisplayConfig[];
  children: React.ReactNode;
}) => {
  const getStyle = useCallback((deviceName?: string) => getDeviceStyle(deviceName, deviceConfigs), [deviceConfigs]);
  const getDisplayName = useCallback(
    (deviceName: string) => getDeviceDisplayName(deviceName, deviceConfigs),
    [deviceConfigs],
  );
  const value = useMemo<DeviceConfigContextValue>(
    () => ({
      deviceConfigs,
      getDeviceStyle: getStyle,
      getDeviceDisplayName: getDisplayName,
    }),
    [deviceConfigs, getStyle, getDisplayName],
  );
  return <DeviceConfigContext.Provider value={value}>{children}</DeviceConfigContext.Provider>;
};

export const useDeviceConfig = (): DeviceConfigContextValue => {
  const ctx = useContext(DeviceConfigContext);
  if (!ctx) {
    return {
      deviceConfigs: undefined,
      getDeviceStyle: (name?: string) => getDeviceStyle(name, []),
      getDeviceDisplayName: (name: string) => getDeviceDisplayName(name, []),
    };
  }
  return ctx;
};
