# Asset+ Sync (FMGUID)
The Asset+ sync API:s mainly revolve around synchronizing `Parameters`, `Objects`, `Relationships` and `Property Values`.

Described in this document are the ways to perform sync operations when `FMGUID` is the main bearer of identity.

[Parameters](#Parameters) represent the desired way to view and interact with objects. They contain important information for how to query and mutate them on objects as property values, and also what the rules are like data type, possible values, and more.

[Objects](#Objects) represent physical and non-physical objects.

[Relationships](#Relationships) represent containment relationships between objects, and for Doors what Space they swing into or out of.

[Property Values](#Property-Values) are the detailed data of the objects.
## Pre-requisites
1. An Asset+ API URL
1. A valid access token
1. An API key
## Reading data
Since the data structure is very flat, there is only a single API call to fetch an object, its relationships and property values: [PublishDataServiceGetMerged](#PublishDataServiceGetMerged)

Common use-cases are mapped to appropriate filters.

**Note:** The CreationDate may be set while the LastUpdatedDate may not be set, in those cases always use the CreationDate

## Mutating data
Mutations have separate API calls depending on the type of mutation and what is being mutated.

Creation and updating in a single flow:
1. Call [PublishDataServiceGetMerged](#PublishDataServiceGetMerged) to figure out which objects already exist
1. Call [AddObjectList](#AddObjectList) to create the missing objects (Complexes first then Buildings then the rest)
1. Call [PublishDataServiceGet](#PublishDataServiceGet) to figure out which already existing objects are part of a model
1. Call [UpsertRelationships](#UpsertRelationships) to move the objects (Level, Space, Instance) not part of a model to under their actual parent object
1. Call [GetAllParameters](#GetAllParameters) so we can skip updating values that are no longer relevant
1. Call [UpdateBimObjectsPropertiesData](#UpdateBimObjectsPropertiesData) to upsert relevant data

Updating existing objects:
1. Call [PublishDataServiceGetMerged](#PublishDataServiceGetMerged) to figure out which objects already exist
1. Call [PublishDataServiceGet](#PublishDataServiceGet) to figure out if the object is part of a model
1. If not part of a model, call [UpsertRelationships](#UpsertRelationships) to move the objects (Level, Space, Instance) to under their actual parent object
1. Call [GetAllParameters](#GetAllParameters) so we can skip updating values that are no longer relevant
1. Call [UpdateBimObjectsPropertiesData](#UpdateBimObjectsPropertiesData) to upsert data

Please refer to the [API Reference](#API-Reference) for available API calls.
## API Reference
All calls need an `Authorization` header with a valid access token.

[GetAllParameters](#GetAllParameters) is the only `GET`-able endpoint. Use `POST` for the rest.
### Parameters
#### GetAllParameters
Response:
```json
[
  {
    "parameter": {
      "parameterId": "5616f5b9-6bea-4726-933c-03f7bcb6e780",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "ExternalGuid",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": false
    },
    "sourceNames": [],
    "flatPropertyName": "externalGuid"
  },
  {
    "parameter": {
      "parameterId": "a288b6c1-3dbe-4bf2-88de-04891bb4686a",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "ToRoomDesignation",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": false
    },
    "sourceNames": [],
    "flatPropertyName": "toRoomDesignation"
  },
  {
    "parameter": {
      "parameterId": "71b71a3f-f252-43ff-bab8-077ead1c115a",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "CommonName",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": {
        "setRule": null,
        "dataType": 0,
        "ruleValues": []
      },
      "parameterGroup": null,
      "canBeMapped": true
    },
    "sourceNames": [],
    "flatPropertyName": "commonName"
  },
  {
    "parameter": {
      "parameterId": "a399b1c3-209e-47c9-bd5d-0d7e0664e3c5",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "LevelDesignation",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": false
    },
    "sourceNames": [],
    "flatPropertyName": "levelDesignation"
  },
  {
    "parameter": {
      "parameterId": "df4ca647-a432-4f22-b352-0dde083ff24b",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "InRoomBimObjectId",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": false
    },
    "sourceNames": [],
    "flatPropertyName": "inRoomBimObjectId"
  },
  {
    "parameter": {
      "parameterId": "a582c949-9a24-45a5-8b9b-13d1aaea83ac",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "Room Number",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": true
    },
    "sourceNames": [],
    "flatPropertyName": "Room Number"
  },
  {
    "parameter": {
      "parameterId": "a6cdc84d-e4e5-40ce-8cb7-171421e1d0ff",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "EntityCommonName",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": false
    },
    "sourceNames": [],
    "flatPropertyName": "buildingCommonName"
  },
  {
    "parameter": {
      "parameterId": "c8934079-66d1-4d5a-b7bf-1bf0ead86a73",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "FromRoomDesignation",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": false
    },
    "sourceNames": [],
    "flatPropertyName": "fromRoomDesignation"
  },
  {
    "parameter": {
      "parameterId": "11002731-4771-4b18-a1b3-1d03f4abcc92",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "FmGuid",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": {
        "setRule": null,
        "dataType": 0,
        "ruleValues": []
      },
      "parameterGroup": null,
      "canBeMapped": true
    },
    "sourceNames": [],
    "flatPropertyName": "fmGuid"
  },
  {
    "parameter": {
      "parameterId": "878810be-d470-448a-b739-30b6ef9fe97f",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "FromRoomBimObjectId",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": false
    },
    "sourceNames": [],
    "flatPropertyName": "fromRoomBimObjectId"
  },
  {
    "parameter": {
      "parameterId": "49e55529-3a30-4628-ba6c-38e6ce4fda9f",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "ModelCommonName",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": false
    },
    "sourceNames": [],
    "flatPropertyName": "modelCommonName"
  },
  {
    "parameter": {
      "parameterId": "518eb978-d3ad-4f78-b209-3c8966c60fee",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "ExternalType",
      "parameterType": 1,
      "dataType": 1,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": false
    },
    "sourceNames": [],
    "flatPropertyName": "externalType"
  },
  {
    "parameter": {
      "parameterId": "0988c09c-2505-4994-9158-3eb24be9c1ad",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "ModelDisciplineId",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": false
    },
    "sourceNames": [],
    "flatPropertyName": "modelDisciplineId"
  },
  {
    "parameter": {
      "parameterId": "a7761cea-fabf-406d-93ef-40facbbfe2ae",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "InRoomFmGuid",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": false
    },
    "sourceNames": [],
    "flatPropertyName": "inRoomFmGuid"
  },
  {
    "parameter": {
      "parameterId": "530ff847-e88f-48ee-a320-4397ffa4b724",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "BuildingBimObjectId",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": false
    },
    "sourceNames": [],
    "flatPropertyName": "buildingBimObjectId"
  },
  {
    "parameter": {
      "parameterId": "bd3bc748-b5c3-470f-bbd5-4651b0d66124",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "Status",
      "parameterType": 1,
      "dataType": 1,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": false
    },
    "sourceNames": [],
    "flatPropertyName": "status"
  },
  {
    "parameter": {
      "parameterId": "fc255d5c-7ff1-4454-b2fc-468d22e4b5d7",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "FromRoomCommonName",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": false
    },
    "sourceNames": [],
    "flatPropertyName": "fromRoomCommonName"
  },
  {
    "parameter": {
      "parameterId": "0413b190-aa77-490f-8445-56fb578976d2",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "ComplexDesignation",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": false
    },
    "sourceNames": [],
    "flatPropertyName": "complexDesignation"
  },
  {
    "parameter": {
      "parameterId": "48a49301-d2f0-44a2-a84a-572440768d51",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "ComplexCommonName",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": false
    },
    "sourceNames": [],
    "flatPropertyName": "complexCommonName"
  },
  {
    "parameter": {
      "parameterId": "e10e9814-e989-4467-94a9-5bf2154d4d85",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "LevelBimObjectId",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": false
    },
    "sourceNames": [],
    "flatPropertyName": "levelBimObjectId"
  },
  {
    "parameter": {
      "parameterId": "0885f568-c9d7-4cc4-858b-5cc2a3dd6a0b",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "InRoomDesignation",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": false
    },
    "sourceNames": [],
    "flatPropertyName": "inRoomDesignation"
  },
  {
    "parameter": {
      "parameterId": "82d6e34d-8fde-4613-8665-5d17f4845c7a",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "EntityDesignation",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": false
    },
    "sourceNames": [],
    "flatPropertyName": "buildingDesignation"
  },
  {
    "parameter": {
      "parameterId": "b95cd013-6841-4ccd-9603-645a63798028",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "ToRoomCommonName",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": false
    },
    "sourceNames": [],
    "flatPropertyName": "toRoomCommonName"
  },
  {
    "parameter": {
      "parameterId": "27d0925b-7966-4bc9-ab1a-6ae7b7480028",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "ObjectType",
      "parameterType": 1,
      "dataType": 1,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": false
    },
    "sourceNames": [],
    "flatPropertyName": "objectType"
  },
  {
    "parameter": {
      "parameterId": "851af27c-81b4-46c2-bb08-6ea0d5461fde",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "ExternalId",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": false
    },
    "sourceNames": [],
    "flatPropertyName": "externalId"
  },
  {
    "parameter": {
      "parameterId": "9ee050b6-46b7-41ac-b442-7827009a8c99",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "ObjectTypeValue",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": false
    },
    "sourceNames": [],
    "flatPropertyName": "ObjectTypeValue"
  },
  {
    "parameter": {
      "parameterId": "6ac2a191-13f8-4765-9a55-79bc03c00993",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "ComplexFmGuid",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": false
    },
    "sourceNames": [],
    "flatPropertyName": "complexFmGuid"
  },
  {
    "parameter": {
      "parameterId": "52ab5954-77c2-4bce-bc69-9963c543f7b9",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "ComplexBimObjectId",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": false
    },
    "sourceNames": [],
    "flatPropertyName": "complexBimObjectId"
  },
  {
    "parameter": {
      "parameterId": "1f2ccb04-9c53-4bdb-ac28-ad9ea1b968bc",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "Room Name",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": true
    },
    "sourceNames": [],
    "flatPropertyName": "Room Name"
  },
  {
    "parameter": {
      "parameterId": "54b0dfdf-dd0f-4190-84c8-bf3711f1966d",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "RevisionId",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": false
    },
    "sourceNames": [],
    "flatPropertyName": "revisionId"
  },
  {
    "parameter": {
      "parameterId": "5f8050f2-946a-47f1-91f1-bfbb1c858934",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "BuildingFmGuid",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": false
    },
    "sourceNames": [],
    "flatPropertyName": "buildingFmGuid"
  },
  {
    "parameter": {
      "parameterId": "63be7e02-470c-48f3-8f98-c070590d3f72",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "ModelBimObjectId",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": false
    },
    "sourceNames": [],
    "flatPropertyName": "modelBimObjectId"
  },
  {
    "parameter": {
      "parameterId": "2edc7365-b896-4042-a8d1-c11b705e01e7",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "BimObjectId",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": false
    },
    "sourceNames": [],
    "flatPropertyName": "bimObjectId"
  },
  {
    "parameter": {
      "parameterId": "9186defa-d8a1-4495-ba7a-c4b30f13e5d5",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "ToRoomFmGuid",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": false
    },
    "sourceNames": [],
    "flatPropertyName": "toRoomFmGuid"
  },
  {
    "parameter": {
      "parameterId": "c8a0d70e-fe82-4b5d-9244-cef8830d5529",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "LevelFmGuid",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": false
    },
    "sourceNames": [],
    "flatPropertyName": "levelFmGuid"
  },
  {
    "parameter": {
      "parameterId": "a8851996-c603-4620-b8cc-d19062849f54",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "FromRoomFmGuid",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": false
    },
    "sourceNames": [],
    "flatPropertyName": "fromRoomFmGuid"
  },
  {
    "parameter": {
      "parameterId": "db880df2-34c4-48a6-89e0-d5681ce57ad9",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "LevelCommonName",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": false
    },
    "sourceNames": [],
    "flatPropertyName": "levelCommonName"
  },
  {
    "parameter": {
      "parameterId": "280f1f8a-c32a-4d75-8b94-d8ad28dd2788",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "ToRoomBimObjectId",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": false
    },
    "sourceNames": [],
    "flatPropertyName": "toRoomBimObjectId"
  },
  {
    "parameter": {
      "parameterId": "4efe778b-db0b-4672-9f10-dbfc4d59a47c",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "Designation",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": {
        "setRule": null,
        "dataType": 0,
        "ruleValues": []
      },
      "parameterGroup": null,
      "canBeMapped": true
    },
    "sourceNames": [],
    "flatPropertyName": "designation"
  },
  {
    "parameter": {
      "parameterId": "ba315d76-78b2-49fb-8c63-e62189bb3e4c",
      "tenantId": "6c142b45-a150-4500-82b4-623e76c4e7fc",
      "name": "Param 1",
      "parameterType": 0,
      "dataType": 0,
      "objectType": 0,
      "rule": {
        "setRule": null,
        "dataType": 0,
        "ruleValues": []
      },
      "parameterGroup": null,
      "canBeMapped": true
    },
    "sourceNames": [],
    "flatPropertyName": "param1BC2331D0B470A9536944C156DF6951B0841CA25A"
  },
  {
    "parameter": {
      "parameterId": "b0c4f091-37ad-4277-bbea-e6f23897d3b3",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "name": "InRoomCommonName",
      "parameterType": 1,
      "dataType": 0,
      "objectType": 0,
      "rule": null,
      "parameterGroup": null,
      "canBeMapped": false
    },
    "sourceNames": [],
    "flatPropertyName": "inRoomCommonName"
  }
]
```
#### CreateParameter
Fill in `Name`, `ParameterType: Tenant`, `DataType` (and `Rule` for possible values).

`Name` is case insensitive and unique.

Allowable characters for `Name`:
- Letters
- Digits
- Whitespace
- `Å Ä Ö å ä ö Æ æ Ø ø`
- `+ - . / # _ , : ; ( ) ' % " . @ ! ¤ & = ' ‘ ’ ´ ^ * – ° £ $ ½`
 
When `Name` is matched to an existing `Parameter` then `CreateParameter` will not mutate anything and will just return `200 OK`.

Payload:
```json
{
  "parameter": {
    "name":"Param 1",
    "dataType":0
  }
}
```
#### UpdateParameter
Fetch the `Parameter` first (or at least get hold of the `ParameterId`), prepare payload with modifications, then call this function.

See [CreateParameter](#CreateParameter) for `Name` rules. Note that `UpdateParameter` is definitive for Rules

Don't try to update any `Parameter` with `ParameterType: System`.

#### Example payload: Updating dataType to boolean
Payload:
```json
{
  "parameter": {
    "parameterId": "ba315d76-78b2-49fb-8c63-e62189bb3e4c",
    "name": "Param 1",
    "parameterType": 0,
    "dataType": 5,
    "objectType": 0,
    "rule": null,
    "canBeMapped":true
  },
  "sourceNames": [],
  "flatPropertyName":"param1BC2331D0B470A9536944C156DF6951B0841CA25A"
}
```
#### Example payload: Updating dataType to string and setting lookup values
Payload:
```json
{
  "parameter": {
    "parameterId": "ba315d76-78b2-49fb-8c63-e62189bb3e4c",
    "name": "Param 1",
    "parameterType": 0,
    "dataType": 0,
    "objectType": 0,
    "rule": {
      "setRule": 1,
      "dataType": 0,
      "ruleValues": [
        {
          "ruleValueId": "04675079-0f92-47f1-a0f4-6ceca766956a",
          "valueString": "First LV"
        },
        {
          "ruleValueId": "b22d342a-98f4-4009-afe7-302d3c0648fa",
          "valueString": "Second LV"
        }
      ]
    },
    "canBeMapped": true
  },
  "sourceNames": [],
  "flatPropertyName": "param1BC2331D0B470A9536944C156DF6951B0841CA25A"
}
```
Response:
```json
{
  "parameter": {
    "parameterId": "ba315d76-78b2-49fb-8c63-e62189bb3e4c",
    "tenantId": "6c142b45-a150-4500-82b4-623e76c4e7fc",
    "name": "Param 1",
    "parameterType": 0,
    "dataType": 0,
    "objectType": 0,
    "rule": {
      "setRule": 1,
      "dataType": 0,
      "ruleValues": [
        {
          "ruleValueId": "7203eb0c-f3ac-4fed-b618-8ae333cd61e1",
          "valueInt32": null,
          "valueInt64": null,
          "valueDecimal": null,
          "valueString": "First LV"
        },
        {
          "ruleValueId": "78740110-e7da-4aaf-b2e2-4da0b05ca1a2",
          "valueInt32": null,
          "valueInt64": null,
          "valueDecimal": null,
          "valueString": "Second LV"
        }
      ]
    },
    "parameterGroup": null,
    "canBeMapped": true
  },
  "sourceNames": [],
  "flatPropertyName": "param1BC2331D0B470A9536944C156DF6951B0841CA25A"
}
```
### Objects
Be sure to use your API key where applicable for these API calls.
#### PublishDataServiceGetMerged
Use the `POST` version not `GET`. Also, set `outputType: "raw"` in the payload otherwise the response will contain sanitized values. And remember to use an API key.

The API call is based on DevExtreme's Data Source functionality and supports the simpler parts:
- No functions
- Paging
- Sorting
- Filtering
- Searching
- Select
- Grouping

See https://js.devexpress.com/Documentation/Guide/Data_Binding/Data_Layer/#Reading_Data

See Swagger docs for payload and response.

Description of the response's data array elements:
```
System fields
-------------

FmGuid fields are stored as strings with format: 14398020-12ac-478e-baa7-1c95af1c3876
Relation fields can be null.

tenantId: string
fmGuid: string // FmGuid format
objectType: integer // see ObjectType
ObjectTypeValue: string
complexFmGuid: string // Relation, FmGuid format
complexDesignation: string
complexCommonName: string
buildingFmGuid: string // Relation, FmGuid format
buildingDesignation: string
buildingCommonName: string
levelFmGuid: string // Relation, FmGuid format
levelDesignation: string
levelCommonName: string
inRoomFmGuid: string // Relation, FmGuid format
inRoomDesignation: string
inRoomCommonName: string
fromRoomFmGuid: string // Relation for doors, FmGuid format
fromRoomDesignation: string
fromRoomCommonName: string
toRoomFmGuid: string // Relation for doors, FmGuid format
toRoomDesignation: string
toRoomCommonName: string
designation: string // This object's designation
commonName: string // This object's common name
levelName: string // Same as commonName if this object is of type Level
levelNumber: string // Same as designation if this object is of type Level
roomName: string // Same as commonName if this object is of type Space
roomNumber: string // Same as designation if this object is of type Space
dateCreated: date // ISO date-time string
dateModified: date // ISO date-time string
dateExpired: date // ISO date-time string

Property value fields
---------------------

prop1-N are property values keyed by their respective parameter's flatPropertyName, which is a calculated accessor, rather than their raw names. See `parameterWithSourceNames.flatPropertyName`.

prop1: object // see MergedPropertyValueModel
prop2: object // see MergedPropertyValueModel
.
.
propN: object // see MergedPropertyValueModel
```
##### Example payload: Getting the object for a given FMGUID
Body:
```json
{
  "outputType": "raw",
  "apiKey": "f2a84d8a-3200-403c-857c-5012a74c67de",
  "filter": ["fmGuid", "=", "7c395523-8e19-4cc1-aa4f-95207589ab3a"]
}
```
Response:
```json
{
  "data": [
    {
      "_id": "6450cdce3a51abc3473c1bc5",
      "tenantId": "6c142b45-a150-4500-82b4-623e76c4e7fc",
      "fmGuid": "7c395523-8e19-4cc1-aa4f-95207589ab3a",
      "objectType": 4,
      "ObjectTypeValue": null,
      "dateCreated": "2023-05-02T08:46:05.950Z",
      "dateModified": "2023-05-02T11:43:14.786Z",
      "dateExpired": null,
      "designation": null,
      "commonName": null,
      "buildingFmGuid": "1172ebfa-f6fc-4cf6-a19e-70fafbbd325f",
      "buildingDesignation": "B01",
      "buildingCommonName": "B01",
      "complexFmGuid": "84c2f0a0-c25f-41bc-b266-64ed6874b558",
      "complexDesignation": "JATEX01",
      "complexCommonName": "JATEX01",
      "inRoomFmGuid": "bc06289e-55e1-4c5c-af22-2d4e86c431fd",
      "inRoomDesignation": "01001",
      "inRoomCommonName": "01001",
      "param1BC2331D0B470A9536944C156DF6951B0841CA25A": {
        "id": null,
        "name": "Param 1",
        "dataType": 0,
        "value": "Value 1"
      },
      "param2BE42025FF938375816F3AB5E2C1DBEE12BC71FBF": {
        "id": null,
        "name": "Param 2",
        "dataType": 0,
        "value": "Value 2"
      }
    }
  ]
}
```
##### Example payload: Getting the objects for multiple given FMGUIDs
Body:
```json
{
  "outputType": "raw",
  "apiKey": "f2a84d8a-3200-403c-857c-5012a74c67de",
  "filter": [
    ["fmGuid", "=", "7c395523-8e19-4cc1-aa4f-95207589ab3a"],
    "or",
    ["fmGuid", "=", "84c2f0a0-c25f-41bc-b266-64ed6874b558"]
  ]
}
```
Response:
```json
{
  "data": [
    {
      "_id": "6450c3013a51abc3473c1bc1",
      "tenantId": "6c142b45-a150-4500-82b4-623e76c4e7fc",
      "fmGuid": "84c2f0a0-c25f-41bc-b266-64ed6874b558",
      "objectType": 0,
      "ObjectTypeValue": null,
      "dateCreated": "2023-05-02T07:59:59.156Z",
      "dateModified": null,
      "dateExpired": null,
      "designation": "JATEX01",
      "commonName": "JATEX01"
    },
    {
      "_id": "6450cdce3a51abc3473c1bc5",
      "tenantId": "6c142b45-a150-4500-82b4-623e76c4e7fc",
      "fmGuid": "7c395523-8e19-4cc1-aa4f-95207589ab3a",
      "objectType": 4,
      "ObjectTypeValue": null,
      "dateCreated": "2023-05-02T08:46:05.950Z",
      "dateModified": "2023-05-02T11:43:14.786Z",
      "dateExpired": null,
      "designation": null,
      "commonName": null,
      "buildingFmGuid": "1172ebfa-f6fc-4cf6-a19e-70fafbbd325f",
      "buildingDesignation": "B01",
      "buildingCommonName": "B01",
      "complexFmGuid": "84c2f0a0-c25f-41bc-b266-64ed6874b558",
      "complexDesignation": "JATEX01",
      "complexCommonName": "JATEX01",
      "inRoomFmGuid": "bc06289e-55e1-4c5c-af22-2d4e86c431fd",
      "inRoomDesignation": "01001",
      "inRoomCommonName": "01001",
      "param1BC2331D0B470A9536944C156DF6951B0841CA25A": {
        "id": null,
        "name": "Param 1",
        "dataType": 0,
        "value": "Value 1"
      },
      "param2BE42025FF938375816F3AB5E2C1DBEE12BC71FBF": {
        "id": null,
        "name": "Param 2",
        "dataType": 0,
        "value": "Value 2"
      }
    }
  ]
}
```
##### Example payload: Filtering on a property value
Sub-document filtering requires a path to the field, therefore the key is `"param1BC2331D0B470A9536944C156DF6951B0841CA25A.value"`.

Body:
```json
{
  "outputType": "raw",
  "apiKey": "f2a84d8a-3200-403c-857c-5012a74c67de",
  "filter": ["param1BC2331D0B470A9536944C156DF6951B0841CA25A.value", "=", "Value 1"]
}
```
Response:
```json
{
  "data": [
    {
      "_id": "6450cdce3a51abc3473c1bc5",
      "tenantId": "6c142b45-a150-4500-82b4-623e76c4e7fc",
      "fmGuid": "7c395523-8e19-4cc1-aa4f-95207589ab3a",
      "objectType": 4,
      "ObjectTypeValue": null,
      "dateCreated": "2023-05-02T08:46:05.950Z",
      "dateModified": "2023-05-02T11:43:14.786Z",
      "dateExpired": null,
      "designation": null,
      "commonName": null,
      "buildingFmGuid": "1172ebfa-f6fc-4cf6-a19e-70fafbbd325f",
      "buildingDesignation": "B01",
      "buildingCommonName": "B01",
      "complexFmGuid": "84c2f0a0-c25f-41bc-b266-64ed6874b558",
      "complexDesignation": "JATEX01",
      "complexCommonName": "JATEX01",
      "inRoomFmGuid": "bc06289e-55e1-4c5c-af22-2d4e86c431fd",
      "inRoomDesignation": "01001",
      "inRoomCommonName": "01001",
      "param1BC2331D0B470A9536944C156DF6951B0841CA25A": {
        "id": null,
        "name": "Param 1",
        "dataType": 0,
        "value": "Value 1"
      },
      "param2BE42025FF938375816F3AB5E2C1DBEE12BC71FBF": {
        "id": null,
        "name": "Param 2",
        "dataType": 0,
        "value": "Value 2"
      }
    }
  ]
}
```
##### Example payload: Getting the space FMGUIDs in a given Building
Body:
```json
{
  "outputType": "raw",
  "apiKey": "f2a84d8a-3200-403c-857c-5012a74c67de",
  "filter": [
    ["objectType", "=", 3],
    "and",
    ["buildingFmGuid", "=", "1172ebfa-f6fc-4cf6-a19e-70fafbbd325f"]
  ],
  "select": ["fmGuid"]
}
```
Response:
```json
{
  "data": [
    {
      "_id": "6450c7803a51abc3473c1bc4",
      "fmGuid": "bc06289e-55e1-4c5c-af22-2d4e86c431fd"
    }
  ]
}
```
##### Example payload: Getting the FMGUIDs for objects modified (or created) after a given date
Body:
```json
{
  "outputType": "raw",
  "apiKey": "f2a84d8a-3200-403c-857c-5012a74c67de",
  "filter": [
    ["dateModified", ">", "2023-05-02"],
    "or",
    [
      ["dateModified", "=", null],
      "and",
      ["dateCreated", ">", "2023-05-02"]
    ]
  ],
  "select": ["fmGuid"]
}
```
Response:
```json
{
  "data": [
    {
      "_id": "6450c3013a51abc3473c1bc1",
      "fmGuid": "84c2f0a0-c25f-41bc-b266-64ed6874b558"
    },
    {
      "_id": "6450c4963a51abc3473c1bc2",
      "fmGuid": "1172ebfa-f6fc-4cf6-a19e-70fafbbd325f"
    },
    {
      "_id": "6450c61c3a51abc3473c1bc3",
      "fmGuid": "4612e405-7841-4384-8c72-4f5b5b473166"
    },
    {
      "_id": "6450ce493a51abc3473c1bc6",
      "fmGuid": "f725b989-463e-49e9-adc2-e6c39face497"
    },
    {
      "_id": "6450cdce3a51abc3473c1bc5",
      "fmGuid": "7c395523-8e19-4cc1-aa4f-95207589ab3a"
    },
    {
      "_id": "6450c7803a51abc3473c1bc4",
      "fmGuid": "bc06289e-55e1-4c5c-af22-2d4e86c431fd"
    }
  ]
}
```
#### PublishDataServiceGet
This endpoint will be unnecessary to call as soon as development finishes that will give [PublishDataServiceGetMerged](#PublishDataServiceGetMerged) the `createdInModel` system field.

Use the `POST` version not `GET`.
##### Example payload: Getting the createdInModel field for a given FMGUID
```json
{
  "filter": ["fmGuid", "=", "14398020-12ac-478e-baa7-1c95af1c3876"],
  "select": ["createdInModel"]
}
```
#### AddObjectList
Adding a Building requires an existing Complex parent object.

Adding a Level, Space or Instance requires an existing Building.

The `parentFmGuid` is left empty for Complex but required for other object types.

All object types, except for Instance, require that Designation and CommonName be non-empty. Set both to the same value if only one is available.

Multiple objects can be added at once, but make sure that above caveats are under taken into account.
##### Example payload: New Complex
Body:
```json Payload
{
  "BimObjectWithParents": [{
	"BimObject": {
	  "ObjectType": 0,
	  "Designation": "EX01",
	  "CommonName": "EX01",
	  "APIKey": "f2a84d8a-3200-403c-857c-5012a74c67de",
	  "FmGuid": "84c2f0a0-c25f-41bc-b266-64ed6874b558",
	  "UsedIdentifier": 1
	}
  }]
}
```
Response:
```json Payload
{
  "bimObjectWithParents": [
    {
      "parentId": null,
      "parentFmGuid": null,
      "usedIdentifier": null,
      "bimObject": {
        "objectType": 0,
        "designation": "JATEX01",
        "commonName": "JATEX01",
        "buildings": null,
        "bimObjectId": "68f28e90-d1ae-4e1c-94d5-43091d3136b4",
        "revisionId": "8b0f5771-1e70-4fb2-a59d-08db47b7a930",
        "tenantId": "6c142b45-a150-4500-82b4-623e76c4e7fc",
        "apiKey": "f2a84d8a-3200-403c-857c-5012a74c67de",
        "modelId": null,
        "status": 0,
        "fmGuid": "84c2f0a0-c25f-41bc-b266-64ed6874b558",
        "usedIdentifier": 1,
        "externalIdType": 0,
        "externalGuid": null,
        "externalId": null,
        "externalType": null,
        "expiredDate": null,
        "propertySets": null,
        "geometries": null,
        "dateCreated": "2023-05-02T07:59:59.1379232Z",
        "dateModified": null,
        "userId": null
      }
    }
  ]
}
```
##### Example payload: New Building
Note that the Complex from the previous example is used for identifying the parent object.

Body:
```json
{
  "BimObjectWithParents": [{
    "ParentFmGuid": "84c2f0a0-c25f-41bc-b266-64ed6874b558",
    "UsedIdentifier": 1,
    "BimObject": {
      "ObjectType": 1,
      "Designation": "B01",
      "CommonName": "B01",
      "APIKey": "f2a84d8a-3200-403c-857c-5012a74c67de",
      "FmGuid": "1172ebfa-f6fc-4cf6-a19e-70fafbbd325f",
      "UsedIdentifier": 1
	}
  }]
}
```
Response:
```json
{
  "bimObjectWithParents": [
    {
      "parentId": "68f28e90-d1ae-4e1c-94d5-43091d3136b4",
      "parentFmGuid": "84c2f0a0-c25f-41bc-b266-64ed6874b558",
      "usedIdentifier": 1,
      "bimObject": {
        "objectType": 1,
        "designation": "B01",
        "commonName": "B01",
        "levels": null,
        "instances": null,
        "models": null,
        "bimObjectId": "b6da63db-f4fd-4253-a0d3-694fdf66d913",
        "revisionId": "8b0f5771-1e70-4fb2-a59d-08db47b7a930",
        "tenantId": "6c142b45-a150-4500-82b4-623e76c4e7fc",
        "apiKey": "f2a84d8a-3200-403c-857c-5012a74c67de",
        "modelId": null,
        "status": 0,
        "fmGuid": "1172ebfa-f6fc-4cf6-a19e-70fafbbd325f",
        "usedIdentifier": 1,
        "externalIdType": 0,
        "externalGuid": null,
        "externalId": null,
        "externalType": null,
        "expiredDate": null,
        "propertySets": null,
        "geometries": null,
        "dateCreated": "2023-05-02T08:06:45.4231451Z",
        "dateModified": null,
        "userId": null
      }
    }
  ]
}
```
##### Example payload: New Level
Note that the Building from the previous example is used for identifying the parent object.

Body:
```json
{
  "BimObjectWithParents": [{
    "ParentFmGuid": "1172ebfa-f6fc-4cf6-a19e-70fafbbd325f",
    "UsedIdentifier": 1,
    "BimObject": {
      "ObjectType": 2,
      "Designation": "L01",
      "CommonName": "L01",
      "APIKey": "f2a84d8a-3200-403c-857c-5012a74c67de",
      "FmGuid": "4612e405-7841-4384-8c72-4f5b5b473166",
      "UsedIdentifier": 1
    }
  }]
}
```
Response:
```json
{
  "bimObjectWithParents": [
    {
      "parentId": "b6da63db-f4fd-4253-a0d3-694fdf66d913",
      "parentFmGuid": "1172ebfa-f6fc-4cf6-a19e-70fafbbd325f",
      "usedIdentifier": 1,
      "bimObject": {
        "objectType": 2,
        "designation": "L01",
        "commonName": "L01",
        "elevation": 0.0,
        "elevationUpper": 0.0,
        "spaces": null,
        "instances": null,
        "bimObjectId": "b06236b9-b4ab-440e-a6c1-0fbd3ba21574",
        "revisionId": "8b0f5771-1e70-4fb2-a59d-08db47b7a930",
        "tenantId": "6c142b45-a150-4500-82b4-623e76c4e7fc",
        "apiKey": "f2a84d8a-3200-403c-857c-5012a74c67de",
        "modelId": "a8621742-8a2a-4701-a3f2-7200fd5bb230",
        "status": 0,
        "fmGuid": "4612e405-7841-4384-8c72-4f5b5b473166",
        "usedIdentifier": 1,
        "externalIdType": 0,
        "externalGuid": null,
        "externalId": null,
        "externalType": null,
        "expiredDate": null,
        "propertySets": null,
        "geometries": null,
        "dateCreated": "2023-05-02T08:13:15.8556384Z",
        "dateModified": null,
        "userId": null
      }
    }
  ]
}
```
##### Example payload: New Space
Note that the Building from the previous example is used for identifying the parent object.

Body:
```json
{
  "BimObjectWithParents": [{
    "ParentFmGuid": "1172ebfa-f6fc-4cf6-a19e-70fafbbd325f",
    "UsedIdentifier": 1,
    "BimObject": {
      "ObjectType": 3,
      "Designation": "01001",
      "CommonName": "01001",
      "APIKey": "f2a84d8a-3200-403c-857c-5012a74c67de",
      "FmGuid": "bc06289e-55e1-4c5c-af22-2d4e86c431fd",
      "UsedIdentifier": 1
    }
  }]
}
```
Response:
```json
{
  "bimObjectWithParents": [
    {
      "parentId": "b6da63db-f4fd-4253-a0d3-694fdf66d913",
      "parentFmGuid": "1172ebfa-f6fc-4cf6-a19e-70fafbbd325f",
      "usedIdentifier": 1,
      "bimObject": {
        "objectType": 3,
        "designation": "01001",
        "commonName": "01001",
        "containedInstances": null,
        "outgoingInstances": null,
        "ingoingInstances": null,
        "spaceOutline": null,
        "bimObjectId": "443de476-6bff-4a2e-b05e-8628943f451d",
        "revisionId": "8b0f5771-1e70-4fb2-a59d-08db47b7a930",
        "tenantId": "6c142b45-a150-4500-82b4-623e76c4e7fc",
        "apiKey": "f2a84d8a-3200-403c-857c-5012a74c67de",
        "modelId": "a8621742-8a2a-4701-a3f2-7200fd5bb230",
        "status": 0,
        "fmGuid": "bc06289e-55e1-4c5c-af22-2d4e86c431fd",
        "usedIdentifier": 1,
        "externalIdType": 0,
        "externalGuid": null,
        "externalId": null,
        "externalType": null,
        "expiredDate": null,
        "propertySets": null,
        "geometries": null,
        "dateCreated": "2023-05-02T08:19:12.2555117Z",
        "dateModified": null,
        "userId": null
      }
    }
  ]
}
```
##### Example payload: New Instance
Note that the Building from the previous example is used for identifying the parent object. And there are no Designation or CommonName fields.

Body:
```json
{
  "BimObjectWithParents": [{
    "ParentFmGuid": "1172ebfa-f6fc-4cf6-a19e-70fafbbd325f",
    "UsedIdentifier": 1,
    "BimObject": {
      "ObjectType": 4,
      "APIKey": "f2a84d8a-3200-403c-857c-5012a74c67de",
      "FmGuid": "f725b989-463e-49e9-adc2-e6c39face497",
      "UsedIdentifier": 1
    }
  }]
}
```
Response:
```json
{
  "bimObjectWithParents": [
    {
      "parentId": "b6da63db-f4fd-4253-a0d3-694fdf66d913",
      "parentFmGuid": "1172ebfa-f6fc-4cf6-a19e-70fafbbd325f",
      "usedIdentifier": 1,
      "bimObject": {
        "objectType": 4,
        "bimObjectId": "c98ecf56-642a-414f-adb1-0ab2496485e8",
        "revisionId": "8b0f5771-1e70-4fb2-a59d-08db47b7a930",
        "tenantId": "6c142b45-a150-4500-82b4-623e76c4e7fc",
        "apiKey": "f2a84d8a-3200-403c-857c-5012a74c67de",
        "modelId": "a8621742-8a2a-4701-a3f2-7200fd5bb230",
        "status": 0,
        "fmGuid": "7c395523-8e19-4cc1-aa4f-95207589ab3a",
        "usedIdentifier": 1,
        "externalIdType": 0,
        "externalGuid": null,
        "externalId": null,
        "externalType": null,
        "expiredDate": null,
        "propertySets": null,
        "geometries": null,
        "dateCreated": "2023-05-02T08:46:05.9212959Z",
        "dateModified": null,
        "userId": null
      }
    }
  ]
}
```
### Relationships
Be sure to use your API key where applicable for these API calls.
#### UpsertRelationships
Only call this for objects with `createdInModel: null/false`, and keep the relationship within the same Building.
##### Example payload: Changing the parent of an object
Body:
```json
{
  "APIKey": "f2a84d8a-3200-403c-857c-5012a74c67de",
  "Relationships": [{
    "FmGuid1": "bc06289e-55e1-4c5c-af22-2d4e86c431fd",
    "FmGuid2": "f725b989-463e-49e9-adc2-e6c39face497"
  }]
}
```
Response:
```json
{
  "dateModified": "2023-05-02T09:57:12.4837559Z"
}
```
### Property Values
Be sure to use your API key where applicable for these API calls.
#### UpdateBimObjectsPropertiesData
In general no values for system parameter and all values user parameters can be edited on the objects, but some values for system parameters are editable: `designation`, `commonName`.

The key used for updating values for user parameters is not the same as when reading (`flatPropertyName`) but is instead the parameter's `Name`.
##### Example payload: Updating the object's value for system parameter commonName
Body:
```json
{
  "APIKey": "f2a84d8a-3200-403c-857c-5012a74c67de",
  "UpdateBimObjectProperties": [{
    "FmGuid": "bc06289e-55e1-4c5c-af22-2d4e86c431fd",
    "UpdateProperties": [{
      "Name": "commonName",
      "Type": 0,
      "Value": "01001 updated"
    }]
  }]
}
```
Response:
```json
{
  "dateModified": "2023-05-02T11:51:09.2242199Z"
}
```
##### Example payload: Updating the object's values for user parameters Param 1 and Param 2
Body:
```json
{
  "APIKey": "f2a84d8a-3200-403c-857c-5012a74c67de",
  "UpdateBimObjectProperties": [{
    "FmGuid": "7c395523-8e19-4cc1-aa4f-95207589ab3a",
    "UpdateProperties": [{
      "Name": "Param 1",
      "Type": 0,
      "Value": "Value 1"
    },{
      "Name": "Param 2",
      "Type": 0,
      "Value": "Value 2"
    }]
  }]
}
```
Response:
```json
{
  "dateModified": "2023-05-02T11:51:09.2242199Z"
}
```
#### ExpireObject
Be sure to use your API key where applicable for these API calls.

Expiring objects have some consequences and constraints:
1. A child object cannot be set to expire later than its parent object
1. Expiring an object will spread the date to its child objects recursively, clamping existing values where needed, or retaining values where earlier
##### Example payload: Expiring an object
```json
{
  "APIKey": "f2a84d8a-3200-403c-857c-5012a74c67de",
  "ExpireBimObjects": [{
    "FmGuid": "f725b989-463e-49e9-adc2-e6c39face497",
    "ExpireDate": "2023-05-02T09:13:00Z"
  }]
}
```