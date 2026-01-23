# Asset+ 3d Viewer Package Documentation

This document provides an in-depth overview and implementation guide of the Asset+ 3d Viewer Package.

## Overview

The Asset+ 3d Viewer Package is a zip file whose contents are used to implement the Asset+ 3d Viewer in non-Vue and/or .Net embedded HTML pages.

## The compressed zip file

### Contents

- `dist/fonts`
- `dist/assetplusviewer.css`
- `dist/assetplusviewer.umd.min.js`
- `external_viewer.html`

#### dist folder

Incorporate the contents of the `dist` folder within your application like any other JavaScript package.

#### external_viewer.html

The file `external_viewer.html` contains example code for how to display and use the 3d viewer.

To run the file in a browser:
1. Extract the zip contents
1. Serve the folder with a http server
1. Browse to `external_viewer.html`

## How to use

For a good start with lots of code examples, see `external_viewer.html`.

### Testing

1. Open `external_viewer.html`
1. Put in a proper API URL and API Key in the call to the `assetplusviewer` function
1. Serve the file in a web server
1. Browse to page
1. Provide a JWT access token in the top left text box
1. Provide an FMGUID in the next text box
1. Click `Display` button

### Quickstart

1. Copy the contents of `external_viewer.html`
1. Remove the `<div>` with the buttons and the button event handlers
1. Implement or inject a script interface and replace `DemoScriptInterface`
1. Put in a proper API URL and API Key in the call to the `assetplusviewer` function

### Custom HTML page

1. In the `<head>` tag make sure to load `/dist/assetplusviewer.css`
1. In the `<body>` tag make sure to set CSS classes, otherwise free-floating, temporary elements like tooltips will not be properly formatted, and set a height to fill up the container. Example: `<body class="dx-device-desktop dx-device-generic dx-theme-material dx-theme-material-typography" style="height: 100%; margin: 0px;">`
1. A `dx-viewport` class must be set on the tag that should constrain the `ObjectDetails` popup. If no class is found, then the `<body>` will be used. Example (the parent `<div>` of the viewer):  `<div class="dx-viewport" style="height: 95%; margin: 0px;">`
1. A `<div>` tag must exist for the JS code to take ownership over. The tag must have id `AssetPlusViewer`, and should also contain a background matching the one in Asset+ client. Example:
```
<div id="AssetPlusViewer" style="width: 100%; height: 100%; display: flex; flex: 1 0 auto; background-image: radial-gradient(90% 100% at center top, rgb(236, 236, 236), rgb(42, 42, 50));">
</div>
```
1. At the end of `<body>` make sure that `dist/assetplusviewer.umd.min.js` is loaded
1. Implement callbacks, setup API URL, API Key, etc.
1. Initialize by calling the `assetplusviewer` function. Highly recommended to do so using the async/await pattern.

### (Custom) HTML page embedded in a CEF container

1. (Follow the quickstart or custom HTML page instructions above)
1. Inject whatever bridging object needed for container-viewer interaction
1. Register load handlers for the files in the zip file

## Scenarios

### Making sure desirable models are loaded

To choose which additional models (in addition to the models the FmGuid itself belongs to) see the section about `additionalDefaultPredicate`, which for `external_viewer.html` has been set be `(model) => (model?.name || "").toLowerCase().startsWith("a")`, i.e. all models starting with "a" or "A".

The useful properties on the model argument are:
1. `name`
1. `type`

The `type` field holds a number with `0` for `Normal model` and `2` for `Preliminary model`. (There is also `1` for `Orphan model` but they won't ever be processed.)

### Building

See the `Display Building` button in `external_viewer.html` for details. After making sure the appropriate models are loaded, selection is cleared and the camera is adjusted. See `Viewer.md` for setting up the camera angles.

### Floor (or Level)

See the `Display` button in `external_viewer.html` for details. After making sure the appropriate models are loaded, selection is cleared and the camera is adjusted. See `Viewer.md` for setting up the camera angles.

### Room (or Space)

#### View in space

See the `View in space (Space)` button in `external_viewer.html` for details. The space geometry is hidden and the camera is placed at the centre of the volume. Camera mode is switched to `First Person Mode`.

#### Cut out floor

See the `Display` button in `external_viewer.html` for details. After making sure the appropriate models are loaded, the room is selected and the camera is adjusted. See `Viewer.md` for setting up the camera angles.

See the injected `View in space` context menu item in `external_viewer.html` for details about jumping into the space for a closer look.

### Installation objects (or Instances/Assets)

#### View fit

See the `Display (Instance)` button in `external_viewer.html` for details. After making sure the appropriate models are loaded, the object is selected and the camera is adjusted to fit the object within the field of view.

#### Door (View fit + first person mode)

See the `Display (Door)` button in `external_viewer.html` for details. After making sure the appropriate models are loaded, the object is selected and the camera is adjusted to fit the object within the field of view and switching to `First Person Mode`.

#### Cut out floor

See the `Display` button in `external_viewer.html` for details. After making sure the appropriate models are loaded, the object is selected and the camera is adjusted. See `Viewer.md` for setting up the camera angles.

## Appendices

### The assetplusviewer function

The `assetplusviewer` function (internally called `initAssetViewer`) is the main entry point for initializing the AssetPlus Viewer application. It sets up the viewer with the provided configuration and mounts it to the DOM.

#### Function Signature

```javascript
initAssetViewer(
  baseUrl,
  apiKey,
  getAccessTokenCallback,
  selectionChangedCallback,
  selectedFmGuidsChangedCallback,
  allModelsLoadedCallback,
  isItemIdEditableCallback,
  isFmGuidEditableCallback,
  additionalDefaultPredicate,
  externalCustomObjectContextMenuItems,
  horizontalAngle,
  verticalAngle,
  annotationTopOffset,
  annotationLeftOffset
)
```

#### Description

The `initAssetViewer` function initializes the AssetPlus Viewer by creating a Vue application and configuring it with the provided parameters. It uses the `AssetDBClient` to handle API interactions and mounts the `App` component to the `#AssetPlusViewer` DOM element.

The function returns a `Promise` that resolves with the mounted Vue component once the viewer is fully initialized.

#### Arguments

##### 1. `baseUrl` (String)
- **Description**: The base URL for the AssetPlus API.
- **Purpose**: Used by the `AssetDBClient` to make API requests.

##### 2. `apiKey` (String)
- **Description**: The API key for authenticating requests.
- **Purpose**: Passed to the `App` component for use in API interactions.

##### 3. `getAccessTokenCallback` (Function)
- **Signature**: 
  ```javascript
  async function getAccessTokenCallback() => Promise<string>
  ```
- **Description**: A callback function that returns a Promise resolving to an access token.
- **Purpose**: Used to retrieve the JWT token for API authentication.

##### 4. `selectionChangedCallback` (Function)
- **Signature**: 
  ```javascript
  function selectionChangedCallback(items, added, removed) => void
  ```
- **Description**: A callback function triggered when the selection in the viewer changes.
- **Parameters**:
  - `items` (Array): The current selection of items.
  - `added` (Array): Items that were added to the selection.
  - `removed` (Array): Items that were removed from the selection.
- **Purpose**: Allows the application to respond to selection changes, such as updating UI elements or triggering additional logic.

##### 5. `selectedFmGuidsChangedCallback` (Function)
- **Signature**: 
  ```javascript
  function selectedFmGuidsChangedCallback(fmGuids, added, removed) => void
  ```
- **Description**: A callback function triggered when the selected FMGUIDs in the viewer change.
- **Parameters**:
  - `fmGuids` (Array): The current selection of FMGUIDs.
  - `added` (Array): FMGUIDs that were added to the selection.
  - `removed` (Array): FMGUIDs that were removed from the selection.
- **Purpose**: Enables the application to handle changes in FMGUID selection, such as updating related data or UI components.

##### 6. `allModelsLoadedCallback` (Function)
- **Signature**: 
  ```javascript
  function allModelsLoadedCallback() => void
  ```
- **Description**: A callback function triggered when all models are loaded in the viewer.
- **Purpose**: Allows the application to perform actions once the viewer is fully loaded, such as enabling UI controls or displaying a message.

##### 7. `isItemIdEditableCallback` (Function)
- **Signature**: 
  ```javascript
  async function isItemIdEditableCallback(itemId) => Promise<boolean>
  ```
- **Description**: A callback function that determines if a specific item ID is editable.
- **Parameters**:
  - `itemId` (String): The ID of the item to check.
- **Returns**: A Promise resolving to `true` if the item is editable, or `false` otherwise.
- **Purpose**: Used to control edit permissions for items in the viewer.

##### 8. `isFmGuidEditableCallback` (Function)
- **Signature**: 
  ```javascript
  async function isFmGuidEditableCallback(fmGuid) => Promise<boolean>
  ```
- **Description**: A callback function that determines if a specific FMGUID is editable.
- **Parameters**:
  - `fmGuid` (String): The FMGUID to check.
- **Returns**: A Promise resolving to `true` if the FMGUID is editable, or `false` otherwise.
- **Purpose**: Similar to `isItemIdEditableCallback`, but specifically for FMGUIDs.

##### 9. `additionalDefaultPredicate` (Function)
- **Signature**: 
  ```javascript
  function additionalDefaultPredicate(model) => boolean
  ```
- **Description**: An optional predicate function for filtering models or items.
- **Parameters**:
  - `model` (Object): The model to evaluate. Fields: `name` (String) and `type` (Number, `0` = normal model, `1` = orphan model, `2` = preliminary model)
- **Returns**: `true` if the model passes the predicate, or `false` otherwise.
- **Purpose**: Allows custom logic to determine which additional models should be loaded into the viewer.

##### 10. `externalCustomObjectContextMenuItems` (Array)
- **Description**: An array of custom context menu items for objects in the viewer.
- **Purpose**: Extends the default context menu with additional options.

##### 11. `horizontalAngle` (Number)
- **Description**: The default horizontal angle for the viewer.
- **Purpose**: Sets the initial horizontal orientation of the viewer.

##### 12. `verticalAngle` (Number)
- **Description**: The default vertical angle for the viewer.
- **Purpose**: Sets the initial vertical orientation of the viewer.

##### 13. `annotationTopOffset` (Number)
- **Description**: The default top offset for annotations.
- **Purpose**: Adjusts the vertical position of annotations in the viewer.

##### 14. `annotationLeftOffset` (Number)
- **Description**: The default left offset for annotations.
- **Purpose**: Adjusts the horizontal position of annotations in the viewer.

#### Return Value

The function returns a `Promise` that resolves with the mounted Vue component (`App`). This allows the caller to interact with the component after initialization.

#### Example Usage

```javascript
const viewer = await initAssetViewer(
  'https://localhost/api/v1/AssetDB',
  '279f14fa-1bc9-42c0-856a-779a1133b615',
  async () => 'your-access-token',
  (items, added, removed) => console.log('Selection changed:', items),
  (fmGuids, added, removed) => console.log('FMGUIDs changed:', fmGuids),
  () => console.log('All models loaded'),
  async (itemId) => true, // All items editable
  async (fmGuid) => false, // No FMGUIDs editable
  (model) => true, // All models visible
  [{ title: 'Custom Action', doAction: (context) => console.log('Action triggered') }],
  135, // Horizontal angle
  45, // Vertical angle
  -10, // Annotation top offset
  -10  // Annotation left offset
);

console.log('Viewer initialized:', viewer);
```

### Viewer methods

#### 1. `setAvailableModelsByFmGuid`
- **Signature**:
  ```javascript
  async setAvailableModelsByFmGuid(fmGuid: string): Promise<void>
  ```
- **Description**: Sets the available models in the viewer based on the provided FMGUID. If no models need loading, it immediately triggers the `allModelsLoadedCallback` anyway.

---

#### 2. `clearSelection`
- **Signature**:
  ```javascript
  clearSelection(): void
  ```
- **Description**: Clears the current selection in the viewer.

---

#### 3. `cutOutFloorByFmGuid`
- **Signature**:
  ```javascript
  cutOutFloorByFmGuid(fmGuid: string): void
  ```
- **Description**: Cuts out a specific floor in the viewer based on the provided FMGUID.

---

#### 4. `cutOutFloorsByFmGuid`
- **Signature**:
  ```javascript
  cutOutFloorsByFmGuid(fmGuid: string, includeRelatedFloors: boolean): void
  ```
- **Description**: Cuts out floors based on the provided FMGUID. Optionally includes related floors in the selection.

---

#### 5. `selectFmGuid`
- **Signature**:
  ```javascript
  selectFmGuid(fmGuid: string): void
  ```
- **Description**: Selects a specific FMGUID in the viewer.

---

#### 6. `selectFmGuidAndViewFit`
- **Signature**:
  ```javascript
  selectFmGuidAndViewFit(fmGuid: string): void
  ```
- **Description**: Selects a specific FMGUID and adjusts the view to fit the selected items.

---

#### 7. `clearData`
- **Signature**:
  ```javascript
  clearData(): void
  ```
- **Description**: Clears all loaded models, selections, and object details in the viewer.

---

#### 8. `setObjectDetailItems`
- **Signature**:
  ```javascript
  setObjectDetailItems(items: Array<string>): void
  ```
- **Description**: Sets the items to display in the property viewer.

---

#### 9. `setObjectDetailsVisibility`
- **Signature**:
  ```javascript
  setObjectDetailsVisibility(visible: boolean): void
  ```
- **Description**: Sets the visibility of the property viewer.

---

#### 10. `canEditItemsCallback`
- **Signature**:
  ```javascript
  async canEditItemsCallback(itemIds: Array<string>): Promise<boolean>
  ```
- **Description**: Determines if the provided items are editable. Uses the `isItemIdEditableCallback` or `isFmGuidEditableCallback` if provided.

---

#### 11. `onSelectionChanged`
- **Signature**:
  ```javascript
  onSelectionChanged(items: Array<string>, added: Array<string>, removed: Array<string>): void
  ```
- **Description**: Handles selection changes in the viewer. Updates the selected BIM object IDs and triggers the `selectionChangedCallback` and `selectedFmGuidsChangedCallback`.

---

#### 12. `onModelBundleLoaded`
- **Signature**:
  ```javascript
  onModelBundleLoaded(): void
  ```
- **Description**: Handles the event when a model bundle is loaded. Triggers the `allModelsLoadedCallback`.

---

#### 13. `onShowObjectDetailsButtonClick`
- **Signature**:
  ```javascript
  onShowObjectDetailsButtonClick(): void
  ```
- **Description**: Displays the details of the currently selected items in the property viewer.

---

#### 14. `onShowObjectDetailsContextMenuClick`
- **Signature**:
  ```javascript
  onShowObjectDetailsContextMenuClick(context: Object): void
  ```
- **Description**: Displays the details of an object selected from the context menu.

---

#### 15. `setViewerAngles`
- **Signature**:
  ```javascript
  setViewerAngles(horizontal: number, vertical: number): void
  ```
- **Description**: Sets the horizontal and vertical angles of the viewer.

---

#### 16. `setAnnotationOffsets`
- **Signature**:
  ```javascript
  setAnnotationOffsets(top: number, left: number): void
  ```
- **Description**: Sets the top and left offsets for annotations.

---

#### 17. `setModelIdToAnnotate`
- **Signature**:
  ```javascript
  setModelIdToAnnotate(modelId: string): void
  ```
- **Description**: Sets the model ID to annotate. Needs to be set together with `setFmGuidToAnnotate` before an annotation can be added.

---

#### 18. `setFmGuidToAnnotate`
- **Signature**:
  ```javascript
  setFmGuidToAnnotate(fmGuid: string): void
  ```
- **Description**: Sets the FMGUID to annotate. Needs to be set together with `setModelIdToAnnotate` before an annotation can be added.

---

#### 19. `setExternalCustomObjectContextMenuItems`
- **Signature**:
  ```javascript
  setExternalCustomObjectContextMenuItems(items: Array<Object>): void
  ```
- **Description**: Sets custom context menu items for objects in the viewer.

---

### AssetViewer functions

Access the AssetViewer via its reference: `viewer.assetViewer`

#### Viewer Interaction

##### **`onAssetViewSizeChanged(rect: DOMRectReadOnly): void`**
Handles changes to the size of the asset view and updates the viewer height.

###### Parameters:
- `rect`: The bounding rectangle of the asset view.

---

##### **`selectFloor(newFloor: string): void`**
Selects a specific floor in the viewer and adjusts the view to fit the floor.

###### Parameters:
- `newFloor`: The ID of the floor to select.

---

##### **`selectFloorsByFmGuid(fmGuids: string | string[]): void`**
Selects floors based on their FMGUIDs.

###### Parameters:
- `fmGuids`: A single FMGUID or an array of FMGUIDs.

---

##### **`selectFloorsByChildIds(childIds: string | string[], expandByCommonProperty?: string): void`**
Selects floors based on their child IDs and optionally expands the selection using a common property.

###### Parameters:
- `childIds`: A single child ID or an array of child IDs.
- `expandByCommonProperty` (optional): A property name to expand the selection.

---

##### **`useTool(tool: ViewerTool | null): void`**
Activates a specific tool in the viewer.

###### Parameters:
- `tool`: The tool to activate (e.g., `"measure"`, `"select"`, `"slicer"`).

---

##### **`setShowFloorplan(value: boolean): void`**
Toggles the visibility of the floorplan.

###### Parameters:
- `value`: Whether to show the floorplan.

---

#### Annotation Management

##### **`onRemoveAnnotation(): Promise<void>`**
Removes the currently selected annotation and updates the viewer state.

---

##### **`onToggleAnnotation(value: boolean): Promise<void>`**
Toggles the visibility of annotations in the viewer.

###### Parameters:
- `value`: Whether to show annotations.

---

##### **`generateGuid(): string`**
Generates a new GUID.

###### Returns:
- A string representing the generated GUID.

---

##### **`getAnnotationCount(): Promise<void>`**
Fetches the total count of annotations for the current models and updates the annotation count.

---

##### **`getAnnotations(): Promise<void>`**
Retrieves all annotations for the current models and updates the viewer state.

---

##### **`transformAnnotations(apiData: any[]): any[]`**
Transforms API annotation data into the viewer's format.

###### Parameters:
- `apiData`: The raw annotation data from the API.

###### Returns:
- An array of transformed annotations.

---

##### **`reverseTransformAnnotations(transformedData: any[]): any[]`**
Reverses transformed annotations back into the API format.

###### Parameters:
- `transformedData`: The transformed annotation data.

###### Returns:
- An array of annotations in the API format.

---

##### **`selectFmGuid(fmGuid: string): any`**
Selects an annotation or item by its FMGUID.

###### Parameters:
- `fmGuid`: The FMGUID to select.

###### Returns:
- The selected annotation or item.

---

##### **`selectBimObjectId(bimObjectId: string): any`**
Selects an annotation or item by its BIM object ID.

###### Parameters:
- `bimObjectId`: The BIM object ID to select.

###### Returns:
- The selected annotation or item.

---

##### **`getFmGuidsByIds(ids: string[]): string[]`**
Retrieves FMGUIDs for a list of item IDs.

###### Parameters:
- `ids`: An array of item IDs.

###### Returns:
- An array of FMGUIDs.

---

#### Model Management

##### **`onModelLoaded(model: ModelInfo): void`**
Handles the event when a model is loaded.

###### Parameters:
- `model`: The loaded model.

---

##### **`onModelBundleLoaded(modelInfos: ModelInfo[]): void`**
Handles the event when a bundle of models is loaded.

###### Parameters:
- `modelInfos`: An array of loaded models.

---

##### **`onLoadedDataCleared(): void`**
Clears all loaded data from the viewer and resets the state.

---

##### **`setAvailableModelsByBimObjectId(id: string, additionalDefaultPredicate: (model: BimModel) => boolean): Promise<boolean>`**
Sets available models based on a BIM object ID.

###### Parameters:
- `id`: The BIM object ID.
- `additionalDefaultPredicate`: A predicate function to filter models.

###### Returns:
- A promise resolving to a boolean indicating success.

---

##### **`setAvailableModelsByBimObjectIds(ids: string[], additionalDefaultPredicate: (model: BimModel) => boolean): Promise<boolean>`**
Sets available models based on multiple BIM object IDs.

###### Parameters:
- `ids`: An array of BIM object IDs.
- `additionalDefaultPredicate`: A predicate function to filter models.

###### Returns:
- A promise resolving to a boolean indicating success.

---

##### **`setAvailableModelsByFmGuid(fmGuid: string, additionalDefaultPredicate: (model: BimModel) => boolean): Promise<boolean>`**
Sets available models based on an FMGUID.

###### Parameters:
- `fmGuid`: The FMGUID.
- `additionalDefaultPredicate`: A predicate function to filter models.

###### Returns:
- A promise resolving to a boolean indicating success.

---

##### **`setAvailableModelsByFmGuids(fmGuids: string[], additionalDefaultPredicate: (model: BimModel) => boolean): Promise<boolean>`**
Sets available models based on multiple FMGUIDs.

###### Parameters:
- `fmGuids`: An array of FMGUIDs.
- `additionalDefaultPredicate`: A predicate function to filter models.

###### Returns:
- A promise resolving to a boolean indicating success.

---

##### **`setAvailableModels(relatedModels: BimModel[], modelCoverage: string[], additionalDefaultPredicate: (model: BimModel) => boolean): boolean`**
Sets the available models for the viewer.

###### Parameters:
- `relatedModels`: An array of related models.
- `modelCoverage`: An array of model coverage IDs.
- `additionalDefaultPredicate`: A predicate function to filter models.

###### Returns:
- A boolean indicating whether models were successfully set.

---

#### Camera and View Controls

##### **`modeChanged(newMode: NavMode): Promise<void>`**
Handles changes to the navigation mode.

###### Parameters:
- `newMode`: The new navigation mode.

---

##### **`onProjectionChange(newProjection: Projection): void`**
Changes the camera projection.

###### Parameters:
- `newProjection`: The new projection mode.

---

##### **`heightChanged(height: number): void`**
Updates the observer height.

###### Parameters:
- `height`: The new height.

---

##### **`onCommand(command: ToolbarCommand, id?: string): void`**
Executes a command from the toolbar.

###### Parameters:
- `command`: The command to execute (e.g., `"resetView"`, `"orbitTowards"`).
- `id` (optional): The ID of the object associated with the command.

---

##### **`onShowSpacesChanged(showSpaces: boolean): void`**
Handles changes to the visibility of spaces in the viewer.

###### Parameters:
- `showSpaces`: Whether to show spaces.

---

##### **`onSlicesChanged(): void`**
Handles changes to the slices in the viewer.

---

#### Utility Methods

##### **`generateGuid(): string`**
Generates a new GUID.

###### Returns:
- A string representing the generated GUID.

---

##### **`arrayContains<T>(array: T[], other: T[]): boolean`**
Checks if one array contains all elements of another array.

###### Parameters:
- `array`: The array to check.
- `other`: The array of elements to look for.

###### Returns:
- A boolean indicating whether all elements are contained.

---

##### **`arrayEquals(a: any[], b: any[]): boolean`**
Checks if two arrays are equal.

###### Parameters:
- `a`: The first array.
- `b`: The second array.

###### Returns:
- A boolean indicating whether the arrays are equal.

---

##### **`modelCompareByName(a: any, b: any): number`**
Compares two models by their names.

###### Parameters:
- `a`: The first model.
- `b`: The second model.

###### Returns:
- A number indicating the comparison result (`-1`, `0`, or `1`).Es

---

### AssetView functions

Access the AssetView via its reference: `viewer.assetViewer.$refs.assetView`

ID:s, like BimObjectId and FmGuid, are case sensitive and UPPER CASE.

#### Viewer Interaction

##### **`debugState(): void`**
Logs the current state of the viewer, including camera and navigation details.

---

##### **`getPropertiesById(itemIds: string[], name?: string): Map<string, any[]>`**
Retrieves properties for specific item IDs.

###### Parameters:
- `itemIds`: An array of item IDs to retrieve properties for.
- `name` (optional): The name of the property to filter by.

###### Returns:
- A `Map<string, any[]>` containing the properties for each item ID.

---

##### **`picked(entity: Entity, canvasPos: number[]): void`**
Handles the selection or deselection of an entity based on the current tool.

###### Parameters:
- `entity`: The entity that was picked.
- `canvasPos`: The canvas position where the pick occurred.

---

##### **`onMouseClick(coords: number[]): void`**
Handles mouse click events for annotations and slicer functionality.

###### Parameters:
- `coords`: The canvas coordinates of the mouse click.

---

##### **`setNavMode(navMode: NavMode): void`**
Sets the navigation mode for the viewer.

###### Parameters:
- `navMode`: The navigation mode to set (`"orbit"`, `"firstPerson"`, or `"planView"`).

---

##### **`selectFloor(floor: string | string[] | undefined): void`**
Selects a specific floor in the viewer.

###### Parameters:
- `floor`: The floor or floors to select.

---

##### **`selectItems(itemIds: string[]): string[]`**
Selects specific items in the viewer.

###### Parameters:
- `itemIds`: An array of item IDs to select.

###### Returns:
- An array of selected item IDs.

---

##### **`unselectItems(itemIds: string[]): void`**
Unselects specific items in the viewer.

###### Parameters:
- `itemIds`: An array of item IDs to unselect.

---

##### **`triggerSelectionChanged(added: string[], removed: string[]): void`**
Emits the `selectionChanged` event with the added and removed items.

###### Parameters:
- `added`: An array of item IDs that were added to the selection.
- `removed`: An array of item IDs that were removed from the selection.

---

##### **`useTool(tool: ViewerTool | null): void`**
Activates a specific tool in the viewer.

###### Parameters:
- `tool`: The tool to activate (`"measure"`, `"eraser"`, `"select"`, or `"slicer"`).

---

##### **`setObserverHeight(height: number): void`**
Sets the observer's height in the viewer.

###### Parameters:
- `height`: The height to set for the observer.

---

#### Model Management

##### **`LoadXKT(mergePropertyName?: string, objectDefaults?: any): void`**
Loads XKT models into the viewer.

###### Parameters:
- `mergePropertyName` (optional): The property name used to merge models.
- `objectDefaults` (optional): Default settings for objects.

---

##### **`LoadViewItem(viewItem: ViewItem, doFlyTo: boolean = true, mergePropertyName?: string, objectDefaults?: any): void`**
Loads a single view item into the viewer.

###### Parameters:
- `viewItem`: The view item to load.
- `doFlyTo`: Whether to fly the camera to the item after loading.
- `mergePropertyName` (optional): The property name used to merge models.
- `objectDefaults` (optional): Default settings for objects.

---

##### **`LoadViewItemBundle(viewItems: ViewItem[], retain: boolean = false, doFlyTo: boolean = false, mergePropertyName?: string, objectDefaults?: any): void`**
Loads a bundle of view items into the viewer.

###### Parameters:
- `viewItems`: An array of view items to load.
- `retain`: Whether to retain previously loaded models.
- `doFlyTo`: Whether to fly the camera to the items after loading.
- `mergePropertyName` (optional): The property name used to merge models.
- `objectDefaults` (optional): Default settings for objects.

---

##### **`ClearLoadedModels(): void`**
Clears all loaded models from the viewer.

---

#### Annotation Management

##### **`triggerAnnotationAdded(annotationData: any): void`**
Emits the `annotationAdded` event with the provided annotation data.

###### Parameters:
- `annotationData`: The data for the added annotation.

---

##### **`triggerAnnotationMoved(annotationData: any): void`**
Emits the `annotationMoved` event with the provided annotation data.

###### Parameters:
- `annotationData`: The data for the moved annotation.

---

##### **`deleteAnnotation(): void`**
Deletes the currently selected annotation.

---

##### **`clearAnnotations(): void`**
Clears all annotations from the viewer.

---

##### **`getSelectedAnnotationId(): string | undefined`**
Returns the ID of the currently selected annotation.

###### Returns:
- The ID of the selected annotation, or `undefined` if no annotation is selected.

---

#### Visibility and Highlighting

##### **`hideAll(): void`**
Hides all objects in the viewer.

---

##### **`hideModels(ids: string[]): void`**
Hides specific models in the viewer.

###### Parameters:
- `ids`: An array of model IDs to hide.

---

##### **`showAll(): void`**
Shows all objects in the viewer.

---

##### **`showModel(id: string, showSpaces: boolean): void`**
Shows a specific model in the viewer.

###### Parameters:
- `id`: The ID of the model to show.
- `showSpaces`: Whether to show spaces in the model.

---

##### **`setVisibleByType(types: string[], visible: boolean): void`**
Sets the visibility of objects by type.

###### Parameters:
- `types`: An array of object types to set visibility for.
- `visible`: Whether to make the objects visible.

---

##### **`highlight(item: string | Entity | string[] | Entity[], highlighted: boolean): void`**
Highlights specific items in the viewer.

###### Parameters:
- `item`: The item or items to highlight.
- `highlighted`: Whether to highlight the items.

---

#### Slices

##### **`clearSlices(id?: string): void`**
Clears all slices or a specific slice by ID.

###### Parameters:
- `id` (optional): The ID of the slice to clear.

---

##### **`flipSlice(id?: string): void`**
Flips the direction of a slice.

###### Parameters:
- `id` (optional): The ID of the slice to flip.

---

##### **`editSlice(id: string): void`**
Enables editing for a specific slice.

###### Parameters:
- `id`: The ID of the slice to edit.

---

#### Camera and View Controls

##### **`lookAt(entity: Entity | string | undefined): void`**
Adjusts the camera to look at a specific entity or position.

###### Parameters:
- `entity`: The entity or position to look at.

---

##### **`getVisibleAABB(ids?: any[]): number[] | undefined`**
Calculates the axis-aligned bounding box (AABB) of the visible objects in the viewer.

###### Parameters:
- `ids` (optional): An array of object IDs to calculate the AABB for. If not provided, the AABB is calculated for all visible objects.

###### Returns:
- A `number[]` representing the AABB of the visible objects, or `undefined` if no valid objects are found.

---

##### **`viewFit(item?: Entity | string | Entity[] | string[] | Annotation, adjustCameraAngle?: boolean): void`**
Fits the camera view to a specific item or the entire scene.

###### Parameters:
- `item` (optional): The item or items to fit the view to.
- `adjustCameraAngle` (optional): Whether to adjust the camera angle after fitting.

---

##### **`viewSelectedInSpace(): void`**
Adjusts the camera to fit the selected items in space.

---

##### **`viewInSpace(requested: Entity | string): void`**
Adjusts the camera to view a specific entity or object in space.

###### Parameters:
- `requested`: The entity or object to view.

---

### Xeokit viewer

Access the Xeokit viewer via its reference: `viewer.assetViewer.$refs.assetView.viewer`

For further details, see: https://xeokit.github.io/xeokit-sdk/docs/