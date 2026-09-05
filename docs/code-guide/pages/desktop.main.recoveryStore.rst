desktop.main.recoveryStore
==========================

.. CG-PAGE source=desktop/src/main/recoveryStore.ts complete=false

*Source file:* ``desktop/src/main/recoveryStore.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-83

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 1-83
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=module-header

``const RECOVERY_DIR_NAME``
---------------------------

.. CG-BLOCK id=const:RECOVERY_DIR_NAME lines=84-86

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 84-86
   :lineno-match:

.. CG-EXPLANATION-START id=const:RECOVERY_DIR_NAME

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:RECOVERY_DIR_NAME

``const RECOVERY_FILE_SUFFIX``
------------------------------

.. CG-BLOCK id=const:RECOVERY_FILE_SUFFIX lines=87-104

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 87-104
   :lineno-match:

.. CG-EXPLANATION-START id=const:RECOVERY_FILE_SUFFIX

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:RECOVERY_FILE_SUFFIX

``const RECOVERY_DECLINED_FILE_SUFFIX``
---------------------------------------

.. CG-BLOCK id=const:RECOVERY_DECLINED_FILE_SUFFIX lines=105-122

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 105-122
   :lineno-match:

.. CG-EXPLANATION-START id=const:RECOVERY_DECLINED_FILE_SUFFIX

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:RECOVERY_DECLINED_FILE_SUFFIX

``const RECOVERY_CORRUPT_FILE_SUFFIX``
--------------------------------------

.. CG-BLOCK id=const:RECOVERY_CORRUPT_FILE_SUFFIX lines=123-128

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 123-128
   :lineno-match:

.. CG-EXPLANATION-START id=const:RECOVERY_CORRUPT_FILE_SUFFIX

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:RECOVERY_CORRUPT_FILE_SUFFIX

``const RECOVERY_KIND``
-----------------------

.. CG-BLOCK id=const:RECOVERY_KIND lines=129-135

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 129-135
   :lineno-match:

.. CG-EXPLANATION-START id=const:RECOVERY_KIND

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:RECOVERY_KIND

``const RECOVERY_FORMAT_VERSION``
---------------------------------

.. CG-BLOCK id=const:RECOVERY_FORMAT_VERSION lines=136-152

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 136-152
   :lineno-match:

.. CG-EXPLANATION-START id=const:RECOVERY_FORMAT_VERSION

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:RECOVERY_FORMAT_VERSION

``const RECOVERY_FILE_CAP_BYTES``
---------------------------------

.. CG-BLOCK id=const:RECOVERY_FILE_CAP_BYTES lines=153-157

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 153-157
   :lineno-match:

.. CG-EXPLANATION-START id=const:RECOVERY_FILE_CAP_BYTES

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:RECOVERY_FILE_CAP_BYTES

``const PROJECT_NAME_MAX_LEN``
------------------------------

.. CG-BLOCK id=const:PROJECT_NAME_MAX_LEN lines=158-158

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 158-158
   :lineno-match:

.. CG-EXPLANATION-START id=const:PROJECT_NAME_MAX_LEN

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:PROJECT_NAME_MAX_LEN

``const ISO_TIMESTAMP_MAX_LEN``
-------------------------------

.. CG-BLOCK id=const:ISO_TIMESTAMP_MAX_LEN lines=159-159

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 159-159
   :lineno-match:

.. CG-EXPLANATION-START id=const:ISO_TIMESTAMP_MAX_LEN

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:ISO_TIMESTAMP_MAX_LEN

``const APP_VERSION_MAX_LEN``
-----------------------------

.. CG-BLOCK id=const:APP_VERSION_MAX_LEN lines=160-166

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 160-166
   :lineno-match:

.. CG-EXPLANATION-START id=const:APP_VERSION_MAX_LEN

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:APP_VERSION_MAX_LEN

``const UUID_PATTERN``
----------------------

.. CG-BLOCK id=const:UUID_PATTERN lines=167-172

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 167-172
   :lineno-match:

.. CG-EXPLANATION-START id=const:UUID_PATTERN

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:UUID_PATTERN

``interface RecoveryStoreConfig``
---------------------------------

.. CG-BLOCK id=interface:RecoveryStoreConfig lines=173-197

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 173-197
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RecoveryStoreConfig

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=interface:RecoveryStoreConfig

``function effectiveCapBytes``
------------------------------

.. CG-BLOCK id=function:effectiveCapBytes lines=198-206

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 198-206
   :lineno-match:

.. CG-EXPLANATION-START id=function:effectiveCapBytes

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:effectiveCapBytes

``interface RecoveryDescriptor``
--------------------------------

.. CG-BLOCK id=interface:RecoveryDescriptor lines=207-231

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 207-231
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RecoveryDescriptor

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=interface:RecoveryDescriptor

``interface RecoveryWriteOptions``
----------------------------------

.. CG-BLOCK id=interface:RecoveryWriteOptions lines=232-241

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 232-241
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RecoveryWriteOptions

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=interface:RecoveryWriteOptions

``interface RecoveryEnvelope``
------------------------------

.. CG-BLOCK id=interface:RecoveryEnvelope lines=242-251

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 242-251
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RecoveryEnvelope

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=interface:RecoveryEnvelope

``let config``
--------------

.. CG-BLOCK id=let:config lines=252-261

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 252-261
   :lineno-match:

.. CG-EXPLANATION-START id=let:config

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=let:config

``function configureRecoveryStore``
-----------------------------------

.. CG-BLOCK id=function:configureRecoveryStore lines=262-269

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 262-269
   :lineno-match:

.. CG-EXPLANATION-START id=function:configureRecoveryStore

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:configureRecoveryStore

``function resetRecoveryStoreForTests``
---------------------------------------

.. CG-BLOCK id=function:resetRecoveryStoreForTests lines=270-274

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 270-274
   :lineno-match:

.. CG-EXPLANATION-START id=function:resetRecoveryStoreForTests

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:resetRecoveryStoreForTests

``function requireConfig``
--------------------------

.. CG-BLOCK id=function:requireConfig lines=275-295

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 275-295
   :lineno-match:

.. CG-EXPLANATION-START id=function:requireConfig

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:requireConfig

``function isValidProjectId``
-----------------------------

.. CG-BLOCK id=function:isValidProjectId lines=296-300

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 296-300
   :lineno-match:

.. CG-EXPLANATION-START id=function:isValidProjectId

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:isValidProjectId

``function assertValidProjectId``
---------------------------------

.. CG-BLOCK id=function:assertValidProjectId lines=301-330

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 301-330
   :lineno-match:

.. CG-EXPLANATION-START id=function:assertValidProjectId

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:assertValidProjectId

``function canonicalProjectId``
-------------------------------

.. CG-BLOCK id=function:canonicalProjectId lines=331-352

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 331-352
   :lineno-match:

.. CG-EXPLANATION-START id=function:canonicalProjectId

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:canonicalProjectId

``function validateWriteOptions``
---------------------------------

.. CG-BLOCK id=function:validateWriteOptions lines=353-372

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 353-372
   :lineno-match:

.. CG-EXPLANATION-START id=function:validateWriteOptions

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:validateWriteOptions

``function recoveryDir``
------------------------

.. CG-BLOCK id=function:recoveryDir lines=373-388

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 373-388
   :lineno-match:

.. CG-EXPLANATION-START id=function:recoveryDir

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:recoveryDir

``function recoveryFilePath``
-----------------------------

.. CG-BLOCK id=function:recoveryFilePath lines=389-404

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 389-404
   :lineno-match:

.. CG-EXPLANATION-START id=function:recoveryFilePath

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:recoveryFilePath

``function declinedRecoveryFilePath``
-------------------------------------

.. CG-BLOCK id=function:declinedRecoveryFilePath lines=405-419

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 405-419
   :lineno-match:

.. CG-EXPLANATION-START id=function:declinedRecoveryFilePath

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:declinedRecoveryFilePath

``function corruptRecoveryFilePath``
------------------------------------

.. CG-BLOCK id=function:corruptRecoveryFilePath lines=420-436

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 420-436
   :lineno-match:

.. CG-EXPLANATION-START id=function:corruptRecoveryFilePath

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:corruptRecoveryFilePath

``function validateEnvelope``
-----------------------------

.. CG-BLOCK id=function:validateEnvelope lines=437-465

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 437-465
   :lineno-match:

.. CG-EXPLANATION-START id=function:validateEnvelope

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:validateEnvelope

``interface ResolvedSlot``
--------------------------

.. CG-BLOCK id=interface:ResolvedSlot lines=466-493

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 466-493
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ResolvedSlot

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=interface:ResolvedSlot

``function quarantinePrimary``
------------------------------

.. CG-BLOCK id=function:quarantinePrimary lines=494-536

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 494-536
   :lineno-match:

.. CG-EXPLANATION-START id=function:quarantinePrimary

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:quarantinePrimary

``function resolveSlot``
------------------------

.. CG-BLOCK id=function:resolveSlot lines=537-578

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 537-578
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolveSlot

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:resolveSlot

``function loadEnvelope``
-------------------------

.. CG-BLOCK id=function:loadEnvelope lines=579-632

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 579-632
   :lineno-match:

.. CG-EXPLANATION-START id=function:loadEnvelope

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:loadEnvelope

``function writeRecovery``
--------------------------

.. CG-BLOCK id=function:writeRecovery lines=633-718

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 633-718
   :lineno-match:

.. CG-EXPLANATION-START id=function:writeRecovery

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:writeRecovery

``function listRecovery``
-------------------------

.. CG-BLOCK id=function:listRecovery lines=719-802

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 719-802
   :lineno-match:

.. CG-EXPLANATION-START id=function:listRecovery

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:listRecovery

``function readRecovery``
-------------------------

.. CG-BLOCK id=function:readRecovery lines=803-831

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 803-831
   :lineno-match:

.. CG-EXPLANATION-START id=function:readRecovery

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:readRecovery

``function declineRecovery``
----------------------------

.. CG-BLOCK id=function:declineRecovery lines=832-859

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 832-859
   :lineno-match:

.. CG-EXPLANATION-START id=function:declineRecovery

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:declineRecovery

``function deleteRecovery``
---------------------------

.. CG-BLOCK id=function:deleteRecovery lines=860-889

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 860-889
   :lineno-match:

.. CG-EXPLANATION-START id=function:deleteRecovery

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:deleteRecovery

``function deleteDeclinedRecovery``
-----------------------------------

.. CG-BLOCK id=function:deleteDeclinedRecovery lines=890-912

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 890-912
   :lineno-match:

.. CG-EXPLANATION-START id=function:deleteDeclinedRecovery

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:deleteDeclinedRecovery

``function deletePrimaryRecovery``
----------------------------------

.. CG-BLOCK id=function:deletePrimaryRecovery lines=913-924

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 913-924
   :lineno-match:

.. CG-EXPLANATION-START id=function:deletePrimaryRecovery

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:deletePrimaryRecovery

``function unlinkIfPresent``
----------------------------

.. CG-BLOCK id=function:unlinkIfPresent lines=925-933

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 925-933
   :lineno-match:

.. CG-EXPLANATION-START id=function:unlinkIfPresent

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:unlinkIfPresent

