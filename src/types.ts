export enum DeviceName {
  DesktopFHD = "desktop-fhd",
  iPhone16 = "iphone16",
  IPadA16Portrait = "ipad-a16-portrait",
  IPadA16Landscape = "ipad-a16-landscape",
}

export type StoryScreenshotsPath = {
  original?: string;
  temp?: string;
  diff?: string;
  new?: string;
};

export type Node = {
  type: "folder" | "file";
  name: string;
  path: string;
  children?: Record<string, Node>;
  storyType?: "new" | "diff";
  deviceName?: DeviceName;
  storyId?: string;
  displayName?: string;
  imagePaths?: StoryScreenshotsPath;
  imageUrls?: StoryScreenshotsPath;
  countPixelDiff?: number | null;
  countDiff?: number;
  countNew?: number;
  countTotal?: number;
};
