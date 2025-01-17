/*
 * Copyright (C) 2020-2021  Yomichan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/* global
 * DictionaryDatabase
 */

class DictionaryEntry {
    constructor(dictionaryController, node, index, dictionaryInfo) {
        this._dictionaryController = dictionaryController;
        this._node = node;
        this._index = index;
        this._dictionaryInfo = dictionaryInfo;
        this._eventListeners = new EventListenerCollection();
        this._detailsContainer = null;
        this._hasDetails = false;
        this._hasCounts = false;
    }

    get node() {
        return this._node;
    }

    get dictionaryTitle() {
        return this._dictionaryInfo.title;
    }

    prepare() {
        const node = this._node;
        const index = this._index;
        const {title, revision, prefixWildcardsSupported, version} = this._dictionaryInfo;

        this._detailsContainer = node.querySelector('.dictionary-details');

        const enabledCheckbox = node.querySelector('.dictionary-enabled');
        const priorityInput = node.querySelector('.dictionary-priority');
        const menuButton = node.querySelector('.dictionary-menu-button');
        const detailsTable = node.querySelector('.dictionary-details-table');
        const outdatedContainer = node.querySelector('.dictionary-outdated-notification');
        const titleNode = node.querySelector('.dictionary-title');
        const versionNode = node.querySelector('.dictionary-version');
        const wildcardSupportedCheckbox = node.querySelector('.dictionary-prefix-wildcard-searches-supported');

        const hasDetails = (detailsTable !== null && this._setupDetails(detailsTable));
        this._hasDetails = hasDetails;

        titleNode.textContent = title;
        versionNode.textContent = `rev.${revision}`;
        if (wildcardSupportedCheckbox !== null) {
            wildcardSupportedCheckbox.checked = !!prefixWildcardsSupported;
        }
        if (outdatedContainer !== null) {
            outdatedContainer.hidden = (version >= 3);
        }
        if (enabledCheckbox !== null) {
            enabledCheckbox.dataset.setting = `dictionaries[${index}].enabled`;
            this._eventListeners.addEventListener(enabledCheckbox, 'settingChanged', this._onEnabledChanged.bind(this), false);
        }
        if (priorityInput !== null) {
            priorityInput.dataset.setting = `dictionaries[${index}].priority`;
        }
        if (menuButton !== null) {
            this._eventListeners.addEventListener(menuButton, 'menuOpen', this._onMenuOpen.bind(this), false);
            this._eventListeners.addEventListener(menuButton, 'menuClose', this._onMenuClose.bind(this), false);
        }
    }

    cleanup() {
        this._eventListeners.removeAllEventListeners();
        const node = this._node;
        if (node.parentNode !== null) {
            node.parentNode.removeChild(node);
        }
    }

    setCounts(counts) {
        const node = this._node.querySelector('.dictionary-counts');
        node.textContent = JSON.stringify({info: this._dictionaryInfo, counts}, null, 4);
        node.hidden = false;
        this._hasCounts = true;
    }

    // Private

    _onMenuOpen(e) {
        const bodyNode = e.detail.menu.bodyNode;
        const showDetails = bodyNode.querySelector('.popup-menu-item[data-menu-action="showDetails"]');
        const hideDetails = bodyNode.querySelector('.popup-menu-item[data-menu-action="hideDetails"]');
        const hasDetails = (this._detailsContainer !== null);
        const detailsVisible = (hasDetails && !this._detailsContainer.hidden);
        if (showDetails !== null) {
            showDetails.hidden = detailsVisible;
            showDetails.disabled = !hasDetails;
        }
        if (hideDetails !== null) {
            hideDetails.hidden = !detailsVisible;
            hideDetails.disabled = !hasDetails;
        }
    }

    _onMenuClose(e) {
        switch (e.detail.action) {
            case 'delete':
                this._delete();
                break;
            case 'showDetails':
                if (this._detailsContainer !== null) { this._detailsContainer.hidden = false; }
                break;
            case 'hideDetails':
                if (this._detailsContainer !== null) { this._detailsContainer.hidden = true; }
                break;
        }
    }

    _onEnabledChanged(e) {
        const {detail: {value}} = e;
        this._node.dataset.enabled = `${value}`;
        this._dictionaryController.updateDictionariesEnabled();
    }

    _setupDetails(detailsTable) {
        const targets = [
            ['Author', 'author'],
            ['URL', 'url'],
            ['Description', 'description'],
            ['Attribution', 'attribution']
        ];

        const dictionaryInfo = this._dictionaryInfo;
        const fragment = document.createDocumentFragment();
        let any = false;
        for (const [label, key] of targets) {
            const info = dictionaryInfo[key];
            if (typeof info !== 'string') { continue; }

            const details = this._dictionaryController.instantiateTemplate('dictionary-details-entry');
            details.dataset.type = key;
            details.querySelector('.dictionary-details-entry-label').textContent = `${label}:`;
            details.querySelector('.dictionary-details-entry-info').textContent = info;
            fragment.appendChild(details);

            any = true;
        }

        detailsTable.appendChild(fragment);
        return any;
    }

    _delete() {
        this._dictionaryController.deleteDictionary(this.dictionaryTitle);
    }
}

class DictionaryController {
    constructor(settingsController, modalController, statusFooter) {
        this._settingsController = settingsController;
        this._modalController = modalController;
        this._statusFooter = statusFooter;
        this._dictionaries = null;
        this._dictionaryEntries = [];
        this._databaseStateToken = null;
        this._checkingIntegrity = false;
        this._checkIntegrityButton = null;
        this._dictionaryEntryContainer = null;
        this._integrityExtraInfoContainer = null;
        this._dictionaryInstallCountNode = null;
        this._dictionaryEnabledCountNode = null;
        this._noDictionariesInstalledWarnings = null;
        this._noDictionariesEnabledWarnings = null;
        this._deleteDictionaryModal = null;
        this._integrityExtraInfoNode = null;
        this._isDeleting = false;
    }

    async prepare() {
        this._checkIntegrityButton = document.querySelector('#dictionary-check-integrity');
        this._dictionaryEntryContainer = document.querySelector('#dictionary-list');
        this._integrityExtraInfoContainer = document.querySelector('#dictionary-list-extra');
        this._dictionaryInstallCountNode = document.querySelector('#dictionary-install-count');
        this._dictionaryEnabledCountNode = document.querySelector('#dictionary-enabled-count');
        this._noDictionariesInstalledWarnings = document.querySelectorAll('.no-dictionaries-installed-warning');
        this._noDictionariesEnabledWarnings = document.querySelectorAll('.no-dictionaries-enabled-warning');
        this._deleteDictionaryModal = this._modalController.getModal('dictionary-confirm-delete');

        yomichan.on('databaseUpdated', this._onDatabaseUpdated.bind(this));
        this._settingsController.on('optionsChanged', this._onOptionsChanged.bind(this));

        document.querySelector('#dictionary-confirm-delete-button').addEventListener('click', this._onDictionaryConfirmDelete.bind(this), false);
        if (this._checkIntegrityButton !== null) {
            this._checkIntegrityButton.addEventListener('click', this._onCheckIntegrityButtonClick.bind(this), false);
        }

        await this._onDatabaseUpdated();
    }

    deleteDictionary(dictionaryTitle) {
        if (this._isDeleting) { return; }
        const modal = this._deleteDictionaryModal;
        modal.node.dataset.dictionaryTitle = dictionaryTitle;
        modal.node.querySelector('#dictionary-confirm-delete-name').textContent = dictionaryTitle;
        modal.setVisible(true);
    }

    instantiateTemplate(name) {
        return this._settingsController.instantiateTemplate(name);
    }

    async updateDictionariesEnabled() {
        const options = await this._settingsController.getOptions();
        this._updateDictionariesEnabledWarnings(options);
    }

    static createDefaultDictionarySettings(name, enabled) {
        return {
            name,
            priority: 0,
            enabled,
            allowSecondarySearches: false,
            definitionsCollapsible: 'not-collapsible'
        };
    }

    static async ensureDictionarySettings(settingsController, dictionaries, optionsFull, modifyGlobalSettings, newDictionariesEnabled) {
        if (typeof dictionaries === 'undefined') {
            dictionaries = await settingsController.getDictionaryInfo();
        }
        if (typeof optionsFull === 'undefined') {
            optionsFull = await settingsController.getOptionsFull();
        }

        const installedDictionaries = new Set();
        for (const {title} of dictionaries) {
            installedDictionaries.add(title);
        }

        const targets = [];
        const {profiles} = optionsFull;
        for (let i = 0, ii = profiles.length; i < ii; ++i) {
            let modified = false;
            const missingDictionaries = new Set([...installedDictionaries]);
            const dictionaryOptionsArray = profiles[i].options.dictionaries;
            for (let j = dictionaryOptionsArray.length - 1; j >= 0; --j) {
                const {name} = dictionaryOptionsArray[j];
                if (installedDictionaries.has(name)) {
                    missingDictionaries.delete(name);
                } else {
                    dictionaryOptionsArray.splice(j, 1);
                    modified = true;
                }
            }

            for (const name of missingDictionaries) {
                const value = DictionaryController.createDefaultDictionarySettings(name, newDictionariesEnabled);
                dictionaryOptionsArray.push(value);
                modified = true;
            }

            if (modified) {
                targets.push({
                    action: 'set',
                    path: `profiles[${i}].options.dictionaries`,
                    value: dictionaryOptionsArray
                });
            }
        }

        if (modifyGlobalSettings && targets.length > 0) {
            await settingsController.modifyGlobalSettings(targets);
        }
    }

    // Private

    _onOptionsChanged({options}) {
        this._updateDictionariesEnabledWarnings(options);
        if (this._dictionaries !== null) {
            this._updateEntries();
        }
    }

    async _onDatabaseUpdated() {
        const token = {};
        this._databaseStateToken = token;
        this._dictionaries = null;
        const dictionaries = await this._settingsController.getDictionaryInfo();
        if (this._databaseStateToken !== token) { return; }
        this._dictionaries = dictionaries;

        await this._updateEntries();
    }

    async _updateEntries() {
        const dictionaries = this._dictionaries;
        this._updateMainDictionarySelectOptions(dictionaries);

        for (const entry of this._dictionaryEntries) {
            entry.cleanup();
        }
        this._dictionaryEntries = [];

        if (this._dictionaryInstallCountNode !== null) {
            this._dictionaryInstallCountNode.textContent = `${dictionaries.length}`;
        }

        const hasDictionary = (dictionaries.length > 0);
        for (const node of this._noDictionariesInstalledWarnings) {
            node.hidden = hasDictionary;
        }

        await DictionaryController.ensureDictionarySettings(this._settingsController, dictionaries, void 0, true, false);

        const options = await this._settingsController.getOptions();
        this._updateDictionariesEnabledWarnings(options);

        const dictionaryInfoMap = new Map();
        for (const dictionary of this._dictionaries) {
            dictionaryInfoMap.set(dictionary.title, dictionary);
        }

        const dictionaryOptionsArray = options.dictionaries;
        for (let i = 0, ii = dictionaryOptionsArray.length; i < ii; ++i) {
            const {name} = dictionaryOptionsArray[i];
            const dictionaryInfo = dictionaryInfoMap.get(name);
            if (typeof dictionaryInfo === 'undefined') { continue; }
            this._createDictionaryEntry(i, dictionaryInfo);
        }
    }

    _updateDictionariesEnabledWarnings(options) {
        let enabledCount = 0;
        if (this._dictionaries !== null) {
            const enabledDictionaries = new Set();
            for (const {name, enabled} of options.dictionaries) {
                if (enabled) {
                    enabledDictionaries.add(name);
                }
            }

            for (const {title} of this._dictionaries) {
                if (enabledDictionaries.has(title)) {
                    ++enabledCount;
                }
            }
        }

        const hasEnabledDictionary = (enabledCount > 0);
        for (const node of this._noDictionariesEnabledWarnings) {
            node.hidden = hasEnabledDictionary;
        }

        if (this._dictionaryEnabledCountNode !== null) {
            this._dictionaryEnabledCountNode.textContent = `${enabledCount}`;
        }
    }

    _onDictionaryConfirmDelete(e) {
        e.preventDefault();

        const modal = this._deleteDictionaryModal;
        modal.setVisible(false);

        const title = modal.node.dataset.dictionaryTitle;
        if (typeof title !== 'string') { return; }
        delete modal.node.dataset.dictionaryTitle;

        this._deleteDictionary(title);
    }

    _onCheckIntegrityButtonClick(e) {
        e.preventDefault();
        this._checkIntegrity();
    }

    _updateMainDictionarySelectOptions(dictionaries) {
        for (const select of document.querySelectorAll('[data-setting="general.mainDictionary"]')) {
            const fragment = document.createDocumentFragment();

            let option = document.createElement('option');
            option.className = 'text-muted';
            option.value = '';
            option.textContent = 'Not selected';
            fragment.appendChild(option);

            for (const {title, sequenced} of dictionaries) {
                if (!sequenced) { continue; }
                option = document.createElement('option');
                option.value = title;
                option.textContent = title;
                fragment.appendChild(option);
            }

            select.textContent = ''; // Empty
            select.appendChild(fragment);
        }
    }

    async _checkIntegrity() {
        if (this._dictionaries === null || this._checkingIntegrity || this._isDeleting) { return; }

        try {
            this._checkingIntegrity = true;
            this._setButtonsEnabled(false);

            const token = this._databaseStateToken;
            const dictionaryTitles = this._dictionaries.map(({title}) => title);
            const {counts, total} = await yomichan.api.getDictionaryCounts(dictionaryTitles, true);
            if (this._databaseStateToken !== token) { return; }

            for (let i = 0, ii = Math.min(counts.length, this._dictionaryEntries.length); i < ii; ++i) {
                const entry = this._dictionaryEntries[i];
                entry.setCounts(counts[i]);
            }

            this._setCounts(counts, total);
        } finally {
            this._setButtonsEnabled(true);
            this._checkingIntegrity = false;
        }
    }

    _setCounts(dictionaryCounts, totalCounts) {
        const remainders = Object.assign({}, totalCounts);
        const keys = Object.keys(remainders);

        for (const counts of dictionaryCounts) {
            for (const key of keys) {
                remainders[key] -= counts[key];
            }
        }

        let totalRemainder = 0;
        for (const key of keys) {
            totalRemainder += remainders[key];
        }

        this._cleanupExtra();
        if (totalRemainder > 0) {
            this.extra = this._createExtra(totalCounts, remainders, totalRemainder);
        }
    }

    _createExtra(totalCounts, remainders, totalRemainder) {
        const node = this.instantiateTemplate('dictionary-extra');
        this._integrityExtraInfoNode = node;

        node.querySelector('.dictionary-total-count').textContent = `${totalRemainder} item${totalRemainder !== 1 ? 's' : ''}`;

        const n = node.querySelector('.dictionary-counts');
        n.textContent = JSON.stringify({counts: totalCounts, remainders}, null, 4);
        n.hidden = false;

        this._integrityExtraInfoContainer.appendChild(node);
    }

    _cleanupExtra() {
        const node = this._integrityExtraInfoNode;
        if (node === null) { return; }
        this._integrityExtraInfoNode = null;

        const parent = node.parentNode;
        if (parent === null) { return; }

        parent.removeChild(node);
    }

    _createDictionaryEntry(index, dictionaryInfo) {
        const node = this.instantiateTemplate('dictionary');
        this._dictionaryEntryContainer.appendChild(node);

        const entry = new DictionaryEntry(this, node, index, dictionaryInfo);
        this._dictionaryEntries.push(entry);
        entry.prepare();
    }

    async _deleteDictionary(dictionaryTitle) {
        if (this._isDeleting || this._checkingIntegrity) { return; }

        const index = this._dictionaryEntries.findIndex((entry) => entry.dictionaryTitle === dictionaryTitle);
        if (index < 0) { return; }

        const statusFooter = this._statusFooter;
        const {node} = this._dictionaryEntries[index];
        const progressSelector = '.dictionary-delete-progress';
        const progressContainers = [
            ...node.querySelectorAll('.progress-container'),
            ...document.querySelectorAll(`#dictionaries-modal ${progressSelector}`)
        ];
        const progressBars = [
            ...node.querySelectorAll('.progress-bar'),
            ...document.querySelectorAll(`${progressSelector} .progress-bar`)
        ];
        const infoLabels = document.querySelectorAll(`${progressSelector} .progress-info`);
        const statusLabels = document.querySelectorAll(`${progressSelector} .progress-status`);
        const prevention = this._settingsController.preventPageExit();
        try {
            this._isDeleting = true;
            this._setButtonsEnabled(false);

            const onProgress = ({processed, count, storeCount, storesProcesed}) => {
                const percent = (
                    (count > 0 && storesProcesed > 0) ?
                    (processed / count) * (storesProcesed / storeCount) * 100.0 :
                    0.0
                );
                const cssString = `${percent}%`;
                const statusString = `${percent.toFixed(0)}%`;
                for (const progressBar of progressBars) { progressBar.style.width = cssString; }
                for (const label of statusLabels) { label.textContent = statusString; }
            };

            onProgress({processed: 0, count: 1, storeCount: 1, storesProcesed: 0});

            for (const progress of progressContainers) { progress.hidden = false; }
            for (const label of infoLabels) { label.textContent = 'Deleting dictionary...'; }
            if (statusFooter !== null) { statusFooter.setTaskActive(progressSelector, true); }

            await this._deleteDictionaryInternal(dictionaryTitle, onProgress);
            await this._deleteDictionarySettings(dictionaryTitle);
        } catch (e) {
            log.error(e);
        } finally {
            prevention.end();
            for (const progress of progressContainers) { progress.hidden = true; }
            if (statusFooter !== null) { statusFooter.setTaskActive(progressSelector, false); }
            this._setButtonsEnabled(true);
            this._isDeleting = false;
            this._triggerStorageChanged();
        }
    }

    _setButtonsEnabled(value) {
        value = !value;
        for (const node of document.querySelectorAll('.dictionary-database-mutating-input')) {
            node.disabled = value;
        }
    }

    async _deleteDictionaryInternal(dictionaryTitle, onProgress) {
        const dictionaryDatabase = await this._getPreparedDictionaryDatabase();
        try {
            await dictionaryDatabase.deleteDictionary(dictionaryTitle, {rate: 1000}, onProgress);
            yomichan.api.triggerDatabaseUpdated('dictionary', 'delete');
        } finally {
            dictionaryDatabase.close();
        }
    }

    async _getPreparedDictionaryDatabase() {
        const dictionaryDatabase = new DictionaryDatabase();
        await dictionaryDatabase.prepare();
        return dictionaryDatabase;
    }

    async _deleteDictionarySettings(dictionaryTitle) {
        const optionsFull = await this._settingsController.getOptionsFull();
        const {profiles} = optionsFull;
        const targets = [];
        for (let i = 0, ii = profiles.length; i < ii; ++i) {
            const {options: {dictionaries}} = profiles[i];
            for (let j = 0, jj = dictionaries.length; j < jj; ++j) {
                if (dictionaries[j].name !== dictionaryTitle) { continue; }
                const path = `profiles[${i}].options.dictionaries`;
                targets.push({
                    action: 'splice',
                    path,
                    start: j,
                    deleteCount: 1,
                    items: []
                });
            }
        }
        await this._settingsController.modifyGlobalSettings(targets);
    }

    _triggerStorageChanged() {
        yomichan.trigger('storageChanged');
    }
}
