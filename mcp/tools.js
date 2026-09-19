/**
 * The MCP tool contract for Ghost Panel.
 *
 * One list, two consumers: the Node server advertises these over MCP, and the
 * browser bridge dispatches on `name`. Keeping the schemas here — rather than
 * duplicated on both sides — is what stops the two halves from drifting apart.
 *
 * Every tool is either a read or a *bounded* write. Nothing here ships code
 * into the page: writes name an object, a control or a skill that already
 * exists, and the values they carry are checked against these schemas before
 * they reach `ui`. Registering a new skill means eval-ing an apply() body from
 * outside the browser, so it is deliberately absent.
 */

const vec3 = (desc) => ({
  type: 'object',
  description: desc,
  properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
  additionalProperties: false,
});

const objectName = {
  type: 'string',
  description: 'Name of a registered object, as returned by get_scene_tree.',
};

/** @type {{name: string, title: string, description: string, readOnly: boolean, inputSchema: object}[]} */
export const TOOLS = [
  // ── Reads ───────────────────────────────────────────────────────────────
  {
    name: 'describe_skills',
    title: 'Describe skills',
    description:
      'The full skill catalog: every skill with its id, category, workflows, declared ' +
      'property schema, whether it is currently mounted, and how often the user has ' +
      'applied it. Start here to learn what this panel can do.',
    readOnly: true,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'suggest_skills',
    title: 'Suggest skills',
    description:
      'Skills ranked for the project as it stands right now — detection against the live ' +
      'scene plus the user\'s own history. Use it to answer "what should I turn on here".',
    readOnly: true,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_scene_tree',
    title: 'Get scene tree',
    description:
      'Every registered object: name, kind, transform, visibility, material names, and ' +
      'which one is selected. This is the map the other tools address objects by.',
    readOnly: true,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_object',
    title: 'Get object',
    description: 'Full state for one registered object, including its transform and materials.',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: { name: objectName },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_materials',
    title: 'List materials',
    description:
      'Every material the palette knows about: id, name, type, colour, and how many meshes ' +
      'use it. The ids are what assign_material takes.',
    readOnly: true,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_panel_state',
    title: 'Get panel state',
    description:
      'Every folder and control currently mounted, with live values. This is how you find ' +
      'out what set_control can address, and how you verify a change landed.',
    readOnly: true,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_diagnostics',
    title: 'Get diagnostics',
    description:
      'Run the integration health checks and return the issues found — missing update loop, ' +
      'unreachable panel, disconnected scene, and so on. Use this first when the user says ' +
      'the panel is broken or empty.',
    readOnly: true,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'screenshot',
    title: 'Screenshot the viewport',
    description:
      'A PNG of the host canvas, as a data URL. The one honest way to confirm a change ' +
      'actually rendered rather than merely being set. Needs a WebGL context created with ' +
      'preserveDrawingBuffer, or the image may come back blank.',
    readOnly: true,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },

  // ── Bounded writes ──────────────────────────────────────────────────────
  {
    name: 'select_object',
    title: 'Select object',
    description: 'Select a registered object, exactly as clicking it in the outliner would.',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: { name: objectName },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_transform',
    title: 'Set transform',
    description:
      'Move, rotate or scale a registered object. Rotation is in radians. Omitted components ' +
      'are left alone. Pushed to the shared undo stack, so the user can Cmd+Z it.',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        name: objectName,
        position: vec3('World position.'),
        rotation: vec3('Euler rotation in radians.'),
        scale: vec3('Scale per axis.'),
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_control',
    title: 'Set a panel control',
    description:
      'Drive a control in the panel by folder and label — the same path a user dragging the ' +
      'slider takes, so the host\'s onChange fires and the change is undoable. Use ' +
      'get_panel_state to find valid names and the shape each value takes.',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Folder name, e.g. "Material".' },
        control: { type: 'string', description: 'Control label, e.g. "Roughness".' },
        value: { description: 'Number, string, boolean, or {x,y,z} — whatever the control takes.' },
      },
      required: ['folder', 'control', 'value'],
      additionalProperties: false,
    },
  },
  {
    name: 'apply_skill',
    title: 'Apply a skill',
    description: 'Mount a skill from the catalog by id. Returns the folder it created.',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Skill id, e.g. "3d.lighting".' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'assign_material',
    title: 'Assign a material',
    description:
      'Put an existing material from the palette onto a registered object. Assigns to the ' +
      'whole object unless you name a slot. Undoable.',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        material: { type: 'string', description: 'Material id (uuid) from list_materials.' },
        object: objectName,
        slot: { type: 'integer', minimum: 0, description: 'Optional material slot index.' },
      },
      required: ['material', 'object'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_camera',
    title: 'Set the camera',
    description:
      'Place the viewport camera, and optionally aim it. On a host that writes the camera ' +
      'every frame this needs the free camera to have taken over first, or the host will ' +
      'overwrite it on the next tick.',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        position: vec3('Camera world position.'),
        target: vec3('Point to look at.'),
      },
      additionalProperties: false,
    },
  },
  {
    name: 'focus_object',
    title: 'Frame an object',
    description: 'Move the camera to frame a registered object, like pressing F in the viewport.',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: { name: objectName },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'undo',
    title: 'Undo',
    description: 'Undo the last change on the shared undo stack, whoever made it.',
    readOnly: false,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'redo',
    title: 'Redo',
    description: 'Redo the last undone change.',
    readOnly: false,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

/** Tool lookup by name, for dispatch on both sides. */
export const TOOLS_BY_NAME = Object.fromEntries(TOOLS.map(t => [t.name, t]));

/** Names that mutate the page, for logging and for the bridge's read-only mode. */
export const WRITE_TOOLS = TOOLS.filter(t => !t.readOnly).map(t => t.name);
