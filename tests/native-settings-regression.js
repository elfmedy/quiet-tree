(async () => {
  if (app.vault.getName() !== "Quiet Tree QA") throw Error("Isolated QA vault required");
  const mobile = qtTestApi.Platform.isMobile;
  const key = mobile ? "delay" : "mouseDelay";
  const other = mobile ? "mouseDelay" : "delay";
  let p = app.plugins.plugins["quiet-tree"];
  const saved = p.settings[key], otherBefore = p.settings[other];
  const exclusions = JSON.stringify(p.settings.excluded);
  app.setting.open(); app.setting.openTabById("quiet-tree");
  const tab = app.setting.activeTab;
  const matches = app.setting.searchIndex.search("长按").filter(r => r.tab.id === "quiet-tree");
  if (!matches.length) throw Error("Setting is missing from actual global search index");
  const hiddenMatches = app.setting.searchIndex.search("assets").filter(r => r.tab.id === "quiet-tree");
  if (mobile && hiddenMatches.length) throw Error("Hidden mobile controls are still searchable");
  const slider = tab.containerEl.querySelector('input[type="range"]');
  slider.value = "620"; slider.dispatchEvent(new Event("change", {bubbles:true}));
  if(p.settings[key]!==620) throw Error("Slider change callback did not run");
  for(let i=0;i<4 && JSON.parse(await app.vault.adapter.read('.obsidian/plugins/quiet-tree/data.json'))[key]!==620;i++) await new Promise(r=>setTimeout(r,25));
  app.setting.close();
  await app.plugins.unloadPlugin("quiet-tree"); await app.plugins.loadPlugin("quiet-tree");
  p = app.plugins.plugins["quiet-tree"];
  if(p.settings[key]!==620 || p.settings[other]!==otherBefore || JSON.stringify(p.settings.excluded)!==exclusions) throw Error("Slider persistence changed the wrong settings");
  p.settings[key]=saved;await p.saveSettings();
  app.setting.open();app.setting.openTabById("quiet-tree");
  return {mobile,searchMatches:matches.length,hiddenMatches:hiddenMatches.length,sliderPersisted:true,otherDelayPreserved:true,exclusionsPreserved:true};
})()
