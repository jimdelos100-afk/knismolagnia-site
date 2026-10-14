/** Strict validation before official SDK parsing; never create phantom model parameters. */
export function validatePhysicsSettings(settings, parameters) {
  const fail = message => { throw new Error('Invalid physics3: ' + message); };
  const finite = (value, label) => { if (!Number.isFinite(value)) fail(label + ' must be finite.'); };
  if (settings?.Version !== 3 || !Array.isArray(settings.PhysicsSettings) || !settings.PhysicsSettings.length) fail('Expected Version 3 and non-empty PhysicsSettings.');
  const native = new Set(parameters.map(p => p.id));
  const inputIds = new Set(), outputIds = new Set();
  let inputs = 0, outputs = 0, vertices = 0;
  for (const setting of settings.PhysicsSettings) {
    const name = setting.Id || '(unnamed setting)';
    if (!Array.isArray(setting.Input) || !setting.Input.length || !Array.isArray(setting.Output) || !setting.Output.length || !Array.isArray(setting.Vertices) || setting.Vertices.length < 2) fail(name + ' requires inputs, outputs, and at least two particles.');
    for (const [group, entries, key, ids] of [['Input', setting.Input, 'Source', inputIds], ['Output', setting.Output, 'Destination', outputIds]]) {
      for (const item of entries) {
        const id = item[key]?.Id;
        if (item[key]?.Target !== 'Parameter' || !native.has(id)) fail(name + ' ' + group + ' parameter is absent from actual MOC3: ' + id);
        ids.add(id);
        if (!['X', 'Y', 'Angle'].includes(item.Type)) fail(name + ' unsupported ' + group + ' type.');
        finite(item.Weight, name + ' weight');
        if (item.Weight < 0 || item.Weight > 100) fail(name + ' weight outside 0..100.');
        if (typeof item.Reflect !== 'boolean') fail(name + ' Reflect must be boolean.');
        if (group === 'Output') {
          if (!Number.isInteger(item.VertexIndex) || item.VertexIndex < 1 || item.VertexIndex >= setting.Vertices.length) fail(name + ' output particle index is invalid.');
          finite(item.Scale, name + ' scale');
        }
      }
    }
    for (const particle of setting.Vertices) {
      for (const key of ['Mobility', 'Delay', 'Acceleration', 'Radius']) { finite(particle[key], name + ' ' + key); if (particle[key] < 0) fail(name + ' negative particle property.'); }
      for (const key of ['X', 'Y']) finite(particle.Position?.[key], name + ' Position.' + key);
    }
    for (const key of ['Position', 'Angle']) {
      const n = setting.Normalization?.[key];
      if (![n?.Minimum, n?.Default, n?.Maximum].every(Number.isFinite) || !(n.Minimum < n.Maximum) || n.Default < n.Minimum || n.Default > n.Maximum) fail(name + ' normalization is invalid.');
    }
    inputs += setting.Input.length; outputs += setting.Output.length; vertices += setting.Vertices.length;
  }
  for (const [key, count] of [['PhysicsSettingCount', settings.PhysicsSettings.length], ['TotalInputCount', inputs], ['TotalOutputCount', outputs], ['VertexCount', vertices]]) if (settings.Meta?.[key] !== count) fail(key + ' does not match actual settings.');
  for (const kind of ['Gravity', 'Wind']) for (const coordinate of ['X', 'Y']) finite(settings.Meta?.EffectiveForces?.[kind]?.[coordinate], kind + '.' + coordinate);
  if (settings.Meta.Fps != null && (!Number.isFinite(settings.Meta.Fps) || settings.Meta.Fps <= 0)) fail('Fps must be positive.');
  return { settingCount: settings.PhysicsSettings.length, inputIds: [...inputIds], outputIds: [...outputIds], particleCount: vertices, fps: settings.Meta.Fps || 0 };
}
