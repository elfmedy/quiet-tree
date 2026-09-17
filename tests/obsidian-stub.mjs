// Host interfaces only. DOM behavior is exercised separately in the Sandbox.
export class Plugin {}
export class PluginSettingTab {}
export class FuzzySuggestModal {}
export class Setting {}
export class Notice {
  static messages = [];
  constructor(message) {
    Notice.messages.push(message);
  }
}
export class TFolder {
  constructor(path, children = []) {
    this.path = path;
    this.children = children;
  }
  isRoot() {
    return this.path === "/";
  }
}
export const getLanguage = () => "en";
export const setIcon = () => {};

export class Modal {}
export const Platform = {};
export const requireApiVersion = () => true;
