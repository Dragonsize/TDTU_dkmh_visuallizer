/*
DISCLAIMER:

This software is provided for educational and personal use only.
The author does not control, monitor, or take responsibility for how this code is used.

Any actions performed using this software are the sole responsibility of the user.

The author shall not be held liable for any misuse, damages, or legal consequences arising from its use.
*/

// ==UserScript==
// @name         TDTU Visualizer
// @namespace    http://tampermonkey.net/
// @version      1.6
// @description  Real-time conflict detection 
// @author       You
// @match        **/default.aspx?go=dky*
// @match        **/DangKyMonHoc*
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    const PERIOD_SLOTS = [
        { period: 1, start: '06:50', end: '07:40' },
        { period: 2, start: '07:40', end: '08:30' },
        { period: 3, start: '08:30', end: '09:20' },
        { period: 4, start: '09:30', end: '10:20' },
        { period: 5, start: '10:20', end: '11:10' },
        { period: 6, start: '11:10', end: '12:00' },
        { period: 7, start: '12:45', end: '13:35' },
        { period: 8, start: '13:35', end: '14:25' },
        { period: 9, start: '14:25', end: '15:15' },
        { period: 10, start: '15:25', end: '16:15' },
        { period: 11, start: '16:15', end: '17:05' },
        { period: 12, start: '17:05', end: '17:55' },
        { period: 13, start: '18:05', end: '18:55' },
        { period: 14, start: '18:55', end: '19:45' },
        { period: 15, start: '19:45', end: '20:35' }
    ];

    const PERIOD_MAP = PERIOD_SLOTS.reduce((acc, slot) => {
        acc[slot.period] = slot;
        return acc;
    }, {});

    const CLASS_COLORS = [
        '#667eea', '#764ba2', '#f093fb', '#4facfe', '#43e97b',
        '#fa709a', '#fee140', '#30b0fe', '#a8edea', '#fed6e3',
        '#ff9ff3', '#54a0ff', '#48dbfb', '#ff6348', '#ffa502'
    ];

    const pickerState = {
        search: '',
        selectedSubjectKey: '',
        previewOptionId: ''
    };

    const pickerOptionMap = new Map();

    function getRowCheckbox(row) {
        if (!row) return null;

        const checkboxes = Array.from(row.querySelectorAll('input[type="checkbox"]'));
        if (checkboxes.length === 0) return null;

        const preferred = checkboxes.filter(cb => {
            const key = `${cb.name || ''} ${cb.id || ''}`.toLowerCase();
            return key.includes('chkchonhangdoi') || key.includes('chkchon');
        });

        const pool = preferred.length > 0 ? preferred : checkboxes;
        return pool.find(cb => !cb.disabled) || pool[0];
    }

    function getClassRows() {
        const allRows = Array.from(document.querySelectorAll('tr'));
        const detectedRows = allRows.filter(row => {
            const checkbox = getRowCheckbox(row);
            const hasCode = row.querySelectorAll('span.textblack').length > 0;
            const hasSchedule = row.querySelectorAll('span.textNumber').length > 0;
            return !!checkbox && hasCode && hasSchedule;
        });

        const checkRows = Array.from(document.querySelectorAll('tr.checkrow')).filter(row => {
            const checkbox = getRowCheckbox(row);
            return !!checkbox && row.querySelectorAll('span.textblack').length > 0 && row.querySelectorAll('span.textNumber').length > 0;
        });

        return detectedRows.length >= checkRows.length ? detectedRows : checkRows;
    }

    function getClassColor(classCode) {
        let hash = 0;
        for (let i = 0; i < classCode.length; i++) {
            hash = ((hash << 5) - hash) + classCode.charCodeAt(i);
            hash = hash & hash; // Convert to 32bit integer
        }
        const index = Math.abs(hash) % CLASS_COLORS.length;
        return CLASS_COLORS[index];
    }

    function toMinutes(hhmm) {
        const [h, m] = hhmm.split(':').map(Number);
        return (h * 60) + m;
    }

    function formatMinutes(totalMinutes) {
        const h = Math.floor(totalMinutes / 60).toString().padStart(2, '0');
        const m = (totalMinutes % 60).toString().padStart(2, '0');
        return `${h}:${m}`;
    }

    const styles = `
        #class-visualizer-widget {
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: min(980px, 95vw);
            max-height: 700px;
            background: #f8fbff;
            border: 2px solid #3f64d6;
            border-radius: 12px;
            box-shadow: 0 14px 32px rgba(17, 39, 91, 0.22);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            z-index: 10000;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .visualizer-header {
            background: linear-gradient(135deg, #355fd8 0%, #2f9ccf 100%);
            color: white;
            padding: 16px;
            font-weight: bold;
            font-size: 16px;
            cursor: move;
            user-select: none;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .visualizer-close {
            background: rgba(255,255,255,0.3);
            border: none;
            color: white;
            cursor: pointer;
            font-size: 18px;
            padding: 4px 8px;
            border-radius: 4px;
            transition: background 0.2s;
        }

        .visualizer-close:hover {
            background: rgba(255,255,255,0.5);
        }

        .visualizer-tabs {
            display: flex;
            background: #eaf0fb;
            border-bottom: 1px solid #c9d7f2;
            padding: 0;
        }

        .visualizer-tab {
            flex: 1;
            padding: 12px 10px;
            background: none;
            border: none;
            cursor: pointer;
            font-size: 13px;
            color: #3f4f6f;
            transition: all 0.2s;
            border-bottom: 3px solid transparent;
        }

        .visualizer-tab:hover {
            background: #dde7f9;
            color: #233454;
        }

        .visualizer-tab.active {
            color: #2c4ec2;
            border-bottom-color: #2c4ec2;
            font-weight: bold;
            background: #f8fbff;
        }

        .visualizer-body {
            flex: 1;
            overflow-y: auto;
            padding: 14px;
        }

        .schedule-workspace {
            display: grid;
            grid-template-columns: 62% 38%;
            gap: 10px;
            align-items: start;
        }

        .schedule-left {
            min-width: 0;
        }

        .schedule-right {
            min-width: 0;
            border-left: 1px solid #d2dff4;
            padding-left: 12px;
        }

        @media (max-width: 1100px) {
            .schedule-workspace {
                grid-template-columns: 1fr;
            }
        }

        .schedule-grid {
            display: grid;
            grid-template-columns: 40px repeat(7, 1fr);
            gap: 2px;
            background: #cfdaf1;
            border: 1px solid #c2d0ea;
        }

        .schedule-cell {
            background: #ffffff;
            padding: 8px;
            font-size: 12px;
            text-align: center;
            min-height: 34px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .schedule-cell.time-header {
            background: #edf3ff;
            font-weight: bold;
            font-size: 10px;
            color: #31405f;
        }

        .schedule-cell.day-header {
            background: #355fd8;
            color: white;
            font-weight: bold;
            font-size: 12px;
        }

        .schedule-cell.class-event {
            background: #355fd8;
            color: white;
            font-weight: bold;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            cursor: pointer;
            padding: 5px;
            border-radius: 3px;
            transition: all 0.2s;
        }

        .schedule-cell.class-event:hover {
            transform: scale(1.05);
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }

        .schedule-cell.class-event.preview {
            border: 2px dashed rgba(255, 255, 255, 0.95);
            opacity: 0.85;
        }

        .schedule-cell.conflict {
            background: #ff6b6b !important;
            color: white;
        }

        .schedule-cell.empty {
            background: white;
        }

        .stats-section {
            background: #f9f9f9;
            padding: 12px;
            border-radius: 6px;
            margin-bottom: 12px;
        }

        .stats-row {
            display: flex;
            justify-content: space-between;
            padding: 6px 0;
            font-size: 13px;
        }

        .stats-label {
            color: #666;
            font-weight: 500;
        }

        .stats-value {
            color: #333;
            font-weight: bold;
        }

        .conflict-warning {
            background: #fff3cd;
            border: 1px solid #ffc107;
            border-radius: 6px;
            padding: 12px;
            margin-bottom: 12px;
            font-size: 12px;
            color: #856404;
        }

        .conflict-warning strong {
            display: block;
            margin-bottom: 6px;
        }

        .conflict-item {
            padding: 8px;
            background: white;
            border-left: 3px solid #ff6b6b;
            margin: 6px 0;
            border-radius: 3px;
            font-size: 11px;
        }

        .selected-classes {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .picker-toolbar {
            margin-bottom: 10px;
        }

        .picker-layout {
            display: grid;
            grid-template-columns: 42% 58%;
            gap: 10px;
        }

        .picker-pane {
            border: 1px solid #cdd9ef;
            border-radius: 8px;
            min-height: 300px;
            background: #f6f9ff;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }

        .picker-pane-header {
            padding: 8px 10px;
            font-size: 12px;
            font-weight: bold;
            color: #2f3f5f;
            border-bottom: 1px solid #d6e1f5;
            background: #eaf1ff;
            position: sticky;
            top: 0;
            z-index: 1;
        }

        .picker-pane-body {
            padding: 8px;
            display: flex;
            flex-direction: column;
            gap: 6px;
            overflow-y: auto;
            max-height: 430px;
        }

        .picker-search {
            width: 100%;
            box-sizing: border-box;
            padding: 8px 10px;
            border: 1px solid #bccae3;
            border-radius: 6px;
            font-size: 13px;
            outline: none;
            color: #233454;
            background: #ffffff;
        }

        .picker-search:focus {
            border-color: #667eea;
            box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.15);
        }

        .picker-list {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .subject-item {
            border: 1px solid #ced8eb;
            border-radius: 6px;
            background: #fff;
            padding: 9px;
            cursor: pointer;
            transition: all 0.15s ease;
        }

        .subject-item:hover {
            border-color: #b9c6ea;
            background: #f8faff;
        }

        .subject-item.active {
            border-color: #667eea;
            background: #eef2ff;
            box-shadow: inset 0 0 0 1px rgba(102, 126, 234, 0.2);
        }

        .subject-item.has-selected {
            border-color: #63bf86;
            background: #ecfbf1;
        }

        .subject-item.has-selected .subject-item-code {
            color: #1c8f4d !important;
        }

        .subject-item.has-selected .subject-item-meta {
            color: #1c8f4d;
            font-weight: 600;
        }

        .subject-item-code {
            font-size: 13px;
            font-weight: bold;
        }

        .subject-item-name {
            font-size: 11px;
            color: #43506b;
            margin-top: 2px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .subject-item-meta {
            font-size: 11px;
            color: #32405e;
            margin-top: 4px;
        }

        .picker-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            border: 1px solid #d3ddef;
            border-radius: 6px;
            padding: 9px 10px;
            background: #fff;
            transition: box-shadow 0.15s ease, border-color 0.15s ease;
        }

        .picker-item:hover {
            border-color: #c8d4ee;
            box-shadow: 0 2px 8px rgba(71, 94, 150, 0.08);
        }

        .picker-item.checked {
            border-color: #86d19d;
            background: #f2fff6;
        }

        .picker-item-main {
            min-width: 0;
            flex: 1;
            cursor: pointer;
        }

        .picker-item-option-id {
            color: #5a6881;
            font-size: 11px;
            margin-left: 6px;
        }

        .picker-item-code {
            font-weight: bold;
            font-size: 13px;
            margin-bottom: 2px;
        }

        .picker-item-name {
            color: #2f3c56;
            font-size: 12px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            margin-bottom: 2px;
        }

        .picker-item-time {
            color: #3f4d68;
            font-size: 11px;
        }

        .picker-toggle {
            border: none;
            border-radius: 5px;
            padding: 7px 12px;
            font-size: 12px;
            cursor: pointer;
            color: #fff;
            background: #3159d2;
            white-space: nowrap;
            font-weight: 600;
        }

        .picker-toggle.checked {
            background: #2e9f58;
        }

        .picker-toggle:disabled {
            background: #a4adbe;
            cursor: not-allowed;
        }

        .class-tag {
            background: #e7f1ff;
            border: 1px solid #667eea;
            border-radius: 4px;
            padding: 8px 10px;
            font-size: 11px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .class-tag-name {
            flex: 1;
            color: #333;
        }

        .class-tag-info {
            color: #666;
            font-size: 10px;
            margin-left: 6px;
        }

        .class-remove {
            background: white;
            border: none;
            color: #ff6b6b;
            cursor: pointer;
            font-size: 12px;
            padding: 2px 6px;
            border-radius: 3px;
            margin-left: 4px;
        }

        .class-remove:hover {
            background: #ff6b6b;
            color: white;
        }

        .view-tab-content {
            display: none;
        }

        .view-tab-content.active {
            display: block;
        }

        .no-conflicts {
            color: #28a745;
            font-weight: bold;
            padding: 12px;
            text-align: center;
            background: #d4edda;
            border-radius: 6px;
            margin-top: 12px;
        }
    `;

    function addStyles() {
        const styleEl = document.createElement('style');
        styleEl.textContent = styles;
        document.head.appendChild(styleEl);
    }

    function getSelectedClasses() {
        const classes = [];

        const rows = getClassRows();

        if (rows.length === 0) {
            console.warn('No class rows found - page structure may be different');
        }
        console.log('🔍 Classes extraction - Found class rows:', rows.length);

        rows.forEach((row, idx) => {
            const checkbox = getRowCheckbox(row);
            if (!checkbox || !checkbox.checked) return;

            const cells = row.querySelectorAll('td span');

            const codeSpan = row.querySelector('span.textblack');
            const nameSpan = row.querySelectorAll('span.textblack')[1];
            const scheduleSpans = row.querySelectorAll('span.textNumber');  
            if (!codeSpan || scheduleSpans.length === 0) return;

            const code = (codeSpan?.textContent?.trim() || '').substring(0, 20);
            const name = (nameSpan?.textContent?.trim() || 'Unknown').substring(0, 50);

            scheduleSpans.forEach(scheduleSpan => {
                const timeStr = parseScheduleText(scheduleSpan?.textContent?.trim() || '');
                const roomStr = extractRoomFromSchedule(scheduleSpan?.textContent?.trim() || '');

                if (timeStr) {  
                    const classData = {
                        name: name,
                        code: code,
                        credits: '0',
                        time: timeStr,
                        room: roomStr,
                        day: '',
                        element: checkbox,
                        rowElement: row
                    };
                    classes.push(classData);
                    console.log('Found selected class instance:', classData);
                }
            });
        });
    console.log('Extraction complete - Total classes:', classes.length);
        return classes;
    }

    function getUniqueClasses(allClasses) {
        const grouped = {};

        allClasses.forEach(cls => {
            if (!grouped[cls.code]) {
                grouped[cls.code] = {
                    name: cls.name,
                    code: cls.code,
                    credits: cls.credits,
                    times: [],
                    room: cls.room,
                    element: cls.element,
                    rowElement: cls.rowElement,
                    color: getClassColor(cls.code)
                };
            }
            grouped[cls.code].times.push(cls.time);
        });

        return Object.values(grouped);
    }

    function getAllClassOptions() {
        const options = [];
        const rows = getClassRows();
        pickerOptionMap.clear();

        rows.forEach((row, rowIndex) => {
            const checkbox = getRowCheckbox(row);
            if (!checkbox) return;

            const codeSpan = row.querySelector('span.textblack');
            const nameSpan = row.querySelectorAll('span.textblack')[1];
            const scheduleSpans = row.querySelectorAll('span.textNumber');

            const code = (codeSpan?.textContent?.trim() || '').substring(0, 20);
            const name = (nameSpan?.textContent?.trim() || 'Unknown').substring(0, 60);
            const times = [];

            scheduleSpans.forEach(span => {
                const parsed = parseScheduleText(span?.textContent?.trim() || '');
                if (parsed) times.push(parsed);
            });

            if (!code) return;

            const rawKey = `${checkbox.id || checkbox.name || code}-${rowIndex}`;
            const optionId = `opt-${rawKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

            options.push({
                id: optionId,
                code,
                name,
                times,
                color: getClassColor(code),
                checked: !!checkbox.checked,
                disabled: !!checkbox.disabled,
                element: checkbox,
                rowElement: row
            });

            pickerOptionMap.set(optionId, {
                element: checkbox,
                rowElement: row,
                code,
                name
            });
        });

        return options;
    }

    function parseScheduleText(text) {
        if (!text) return '';

        console.log('Parsing schedule text:', text);

        
        const dayMatch = text.match(/Thứ\s*([2-7]|CN)/i);
        if (!dayMatch) {
            console.warn('Day not found in:', text);
            return '';
        }

        const dayMap = {
            '2': 'T2', '3': 'T3', '4': 'T4', '5': 'T5',
            '6': 'T6', '7': 'T7', 'CN': 'CN'
        };
        const day = dayMap[dayMatch[1]];

        const periodMatch = text.match(/^[\s\-\.]*(\d+)[\s\-\.]*[\-,]/);
        if (!periodMatch) {
            console.warn('Periods not found in:', text);
            return '';
        }

        const periodStr = periodMatch[1];
        let currentBase = 0;
        const periods = periodStr.split('').map(digit => {
            const d = Number(digit);
            if (d === 0) {
                currentBase = 10;
                return 10;
            } else if (currentBase >= 10) {
                return currentBase + d; 
            } else {
                currentBase = d;
                return d;
            }
        }).filter(p => p >= 1 && p <= 15);

        if (periods.length === 0) return '';

        const minPeriod = Math.min(...periods);
        const maxPeriod = Math.max(...periods);
        const startSlot = PERIOD_MAP[minPeriod];
        const endSlot = PERIOD_MAP[maxPeriod];

        if (!startSlot || !endSlot) {
            console.warn('Invalid period range in:', text, 'raw:', periodStr, 'parsed:', periods);
            return '';
        }

        const result = `${day}(${startSlot.start}-${endSlot.end})`;
        console.log('Parsed schedule:', { text, day, raw: periodStr, periods, result });

        return result;
    }

    function extractRoomFromSchedule(text) {
        const match = text.match(/Phòng\s*([^,]*)/i);
        return match ? match[1].trim() : '';
    }

    function parseSchedule(scheduleStr) {
        if (!scheduleStr) {
            console.warn('parseSchedule: empty schedule string');
            return [];
        }

        console.log('parseSchedule input:', scheduleStr);

        const dayMap = {
            'T2': 1, 'MONDAY': 1,
            'T3': 2, 'TUESDAY': 2,
            'T4': 3, 'WEDNESDAY': 3,
            'T5': 4, 'THURSDAY': 4,
            'T6': 5, 'FRIDAY': 5,
            'T7': 6, 'SATURDAY': 6,
            'CN': 0, 'SUNDAY': 0
        };

        const regex = /(T[2-7]|CN|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s*\((\d{1,2}):(\d{2})\s*[-‐–—]\s*(\d{1,2}):(\d{2})\)/gi;
        const matches = Array.from(scheduleStr.matchAll(regex));

        console.log('Schedule regex matches:', matches.length, matches);

        if (matches.length === 0) {
            console.warn('No regex matches found for schedule:', scheduleStr);
            return [];
        }

        const result = matches.map(m => ({
            day: dayMap[m[1].toUpperCase()] !== undefined ? dayMap[m[1].toUpperCase()] : 0,
            startTime: toMinutes(`${m[2]}:${m[3]}`),
            endTime: toMinutes(`${m[4]}:${m[5]}`)
        }));

        console.log('Parsed schedule result:', result);
        return result;
    }

    function findConflicts(classes) {
        const conflicts = [];

        for (let i = 0; i < classes.length; i++) {
            for (let j = i + 1; j < classes.length; j++) {
                const class1 = classes[i];
                const class2 = classes[j];

                const schedule1 = parseSchedule(class1.time);
                const schedule2 = parseSchedule(class2.time);

                for (const s1 of schedule1) {
                    for (const s2 of schedule2) {
                        if (s1.day === s2.day) {
                            if ((s1.startTime < s2.endTime && s1.endTime > s2.startTime)) {
                                const overlapStart = Math.max(s1.startTime, s2.startTime);
                                const overlapEnd = Math.min(s1.endTime, s2.endTime);
                                conflicts.push({
                                    class1: class1.name,
                                    class2: class2.name,
                                    day: s1.day,
                                    time: `${formatMinutes(overlapStart)} - ${formatMinutes(overlapEnd)}`
                                });
                            }
                        }
                    }
                }
            }
        }

        return conflicts;
    }

    function createVisualizer() {
        const container = document.createElement('div');
        container.id = 'class-visualizer-widget';
        container.innerHTML = `
            <div class="visualizer-header">
                <span> Schedule Visualizer</span>
                <div style="display: flex; gap: 8px;">
                    <button style="background: rgba(255,255,255,0.2); border: none; color: white; cursor: pointer; padding: 4px 8px; border-radius: 4px; font-size: 12px;" id="refresh-btn" title="Manual refresh">⟳ Refresh</button>
                    <button class="visualizer-close">✕</button>
                </div>
            </div>

            <div class="visualizer-tabs">
                <button class="visualizer-tab active" data-view="schedule">Schedule</button>
                <button class="visualizer-tab" data-view="conflicts">Conflicts</button>
                <button class="visualizer-tab" data-view="classes">Classes</button>
                <button class="visualizer-tab" data-view="picker">Picker</button>
            </div>

            <div class="visualizer-body">
                <div class="view-tab-content active" data-view="schedule">
                    <div class="schedule-workspace">
                        <div class="schedule-left">
                            <div id="schedule-preview"></div>
                        </div>
                        <div class="schedule-right">
                            <div class="picker-toolbar">
                                <input id="schedule-subject-search" class="picker-search" type="text" placeholder="Search subject code or name...">
                            </div>
                            <div class="picker-layout">
                                <div class="picker-pane">
                                    <div class="picker-pane-header">Subjects</div>
                                    <div id="schedule-subject-list" class="picker-pane-body"></div>
                                </div>
                                <div class="picker-pane">
                                    <div class="picker-pane-header">Class Time Options</div>
                                    <div id="schedule-option-list" class="picker-pane-body"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="view-tab-content" data-view="conflicts">
                    <div id="conflicts-content"></div>
                </div>

                <div class="view-tab-content" data-view="classes">
                    <div id="classes-list"></div>
                </div>

                <div class="view-tab-content" data-view="picker">
                    <div class="picker-toolbar">
                        <input id="picker-subject-search" class="picker-search" type="text" placeholder="Search subject code or name...">
                    </div>
                    <div class="picker-layout">
                        <div class="picker-pane">
                            <div class="picker-pane-header">Subjects</div>
                            <div id="picker-subject-list" class="picker-pane-body"></div>
                        </div>
                        <div class="picker-pane">
                            <div class="picker-pane-header">Class Time Options</div>
                            <div id="picker-option-list" class="picker-pane-body"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        return container;
    }

    function updateVisualization() {
        const allClasses = getSelectedClasses();
        const uniqueClasses = getUniqueClasses(allClasses);
        const conflicts = findConflicts(allClasses);
        const classOptions = getAllClassOptions();
        const previewOption = classOptions.find(opt => opt.id === pickerState.previewOptionId) || null;

        console.log('Visualizer Update:', {
            allClassesFound: allClasses.length,
            uniqueClassesFound: uniqueClasses.length,
            conflictsFound: conflicts.length,
            classes: uniqueClasses
        });

        updateScheduleView(allClasses, uniqueClasses, conflicts, previewOption);
        updateConflictsView(conflicts);
        updateClassesView(uniqueClasses);
        updatePickerView(classOptions);
    }

    function updateScheduleView(allClasses, uniqueClasses, conflicts, previewOption) {
        const container = document.querySelector('#schedule-preview');
        if (!container) {
            console.warn('Schedule preview container not found');
            return;
        }

        console.log('updateScheduleView called with', allClasses.length, 'instances,', uniqueClasses.length, 'unique classes');

        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const timeSlots = PERIOD_SLOTS;
        const previewSchedules = previewOption
            ? previewOption.times.flatMap(time => parseSchedule(time))
            : [];

        const colorMap = {};
        const timesMap = {};
        uniqueClasses.forEach(cls => {
            colorMap[cls.code] = cls.color;
            timesMap[cls.code] = cls.times || [];
        });

        let html = '<div class="schedule-grid">';

        html += '<div class="schedule-cell time-header"></div>';
        dayNames.forEach(day => {
            html += `<div class="schedule-cell day-header">${day}</div>`;
        });

        timeSlots.forEach(slot => {
            const slotStart = toMinutes(slot.start);
            const slotEnd = toMinutes(slot.end);
            html += `<div class="schedule-cell time-header">P${slot.period}<br>${slot.start}-${slot.end}</div>`;

            for (let day = 0; day < 7; day++) {
                let eventHtml = '';
                let hasConflict = false;
                const addedCodes = new Set(); 

                allClasses.forEach((cls, classIndex) => {
                    const schedule = parseSchedule(cls.time);

                    schedule.forEach(s => {
                        const overlaps = s.day === day && s.startTime < slotEnd && s.endTime > slotStart;
                        if (overlaps && !addedCodes.has(cls.code)) { 
                            addedCodes.add(cls.code);
                            const color = colorMap[cls.code] || '#667eea';
                            const titleTimes = timesMap[cls.code].length ? timesMap[cls.code].join(', ') : cls.time;
                            eventHtml += `<div class="schedule-cell class-event" data-class-code="${cls.code}" title="${cls.name} (${titleTimes})" style="background: ${color};">${cls.code}</div>`;

                            conflicts.forEach(conf => {
                                if ((conf.class1 === cls.name || conf.class2 === cls.name) && conf.day === day) {
                                    hasConflict = true;
                                }
                            });
                        }
                    });
                });

                if (previewOption) {
                    const previewOverlaps = previewSchedules.some(s => {
                        return s.day === day && s.startTime < slotEnd && s.endTime > slotStart;
                    });

                    if (previewOverlaps && !addedCodes.has(previewOption.code)) {
                        const previewColor = previewOption.color || '#4facfe';
                        eventHtml += `<div class="schedule-cell class-event preview" title="Preview: ${previewOption.code}" style="background: ${previewColor};">${previewOption.code}</div>`;
                        addedCodes.add(previewOption.code);
                    }
                }

                const cellClass = hasConflict ? 'schedule-cell conflict' : 'schedule-cell';
                html += `<div class="${cellClass}">${eventHtml || ''}</div>`;
            }
        });

        html += '</div>';
        console.log('Schedule grid HTML generated, updating container');
        container.innerHTML = html;

        container.querySelectorAll('[data-class-code]').forEach(el => {
            el.addEventListener('click', () => {
                const classCode = el.getAttribute('data-class-code');
                const cls = uniqueClasses.find(c => c.code === classCode);
                if (cls) jumpToClass(cls);
            });
        });

        console.log('Schedule grid updated');
    }

    function jumpToClass(cls) {
        const target = cls?.rowElement || cls?.element?.closest('tr');
        if (!target) {
            console.warn('Cannot locate source row for class:', cls);
            return;
        }

        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const oldOutline = target.style.outline;
        const oldBackground = target.style.backgroundColor;
        target.style.outline = `3px solid ${cls.color || '#ff6b6b'}`;
        target.style.backgroundColor = '#fff3cd';

        setTimeout(() => {
            target.style.outline = oldOutline;
            target.style.backgroundColor = oldBackground;
        }, 1800);
    }

    function updateConflictsView(conflicts) {
        const container = document.querySelector('#conflicts-content');
        if (!container) {
            console.warn('Conflicts content container not found');
            return;
        }

        if (conflicts.length === 0) {
            container.innerHTML = '<div class="no-conflicts">✓ No scheduling conflicts detected!</div>';
            return;
        }

        let html = '<div class="conflict-warning"><strong>⚠ Conflicts Found:</strong>';

        conflicts.forEach(conf => {
            html += `
                <div class="conflict-item">
                    <strong>${conf.class1}</strong> vs <strong>${conf.class2}</strong>
                    <br>
                    <small>${conf.time}</small>
                </div>
            `;
        });

        html += '</div>';
        container.innerHTML = html;
    }

    function updateClassesView(uniqueClasses) {
        const container = document.querySelector('#classes-list');
        if (!container) {
            console.warn('Classes list container not found');
            return;
        }

        if (uniqueClasses.length === 0) {
            container.innerHTML = '<p style="color: #999; text-align: center;">No classes selected</p>';
            return;
        }

        let html = '<div class="selected-classes">';
        uniqueClasses.forEach((cls) => {
            const timesList = cls.times.join(' + ');
            html += `
                <div class="class-tag" data-class-code="${cls.code}" style="cursor: pointer; border-left: 4px solid ${cls.color};">
                    <div class="class-tag-name">
                        <strong style="color: ${cls.color};">${cls.code}</strong> - ${cls.name}
                        <div class="class-tag-info">${timesList}</div>
                    </div>
                </div>
            `;
        });
        html += '</div>';

        container.innerHTML = html;
        container.querySelectorAll('[data-class-code]').forEach(el => {
            el.addEventListener('click', () => {
                const classCode = el.getAttribute('data-class-code');
                const cls = uniqueClasses.find(c => c.code === classCode);
                if (cls) jumpToClass(cls);
            });
        });
    }

    function getSubjectGroups(options) {
        const map = new Map();
        options.forEach(opt => {
            const key = `${opt.code}__${opt.name}`;
            if (!map.has(key)) {
                map.set(key, {
                    key,
                    code: opt.code,
                    name: opt.name,
                    color: opt.color,
                    options: []
                });
            }
            map.get(key).options.push(opt);
        });

        return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
    }

    function toggleClassOption(optionId) {
        const option = pickerOptionMap.get(optionId || '');
        const checkbox = option?.element;
        if (!checkbox) return;
        if (checkbox.disabled) return;

        checkbox.click();
        setTimeout(updateVisualization, 120);
    }

    function updatePickerView(options) {
        const keyword = (pickerState.search || '').trim().toLowerCase();
        const groups = getSubjectGroups(options).filter(group => {
            if (!keyword) return true;
            return `${group.code} ${group.name}`.toLowerCase().includes(keyword);
        });

        const contexts = [
            {
                subjectContainer: document.querySelector('#picker-subject-list'),
                optionContainer: document.querySelector('#picker-option-list')
            },
            {
                subjectContainer: document.querySelector('#schedule-subject-list'),
                optionContainer: document.querySelector('#schedule-option-list')
            }
        ];

        contexts.forEach(ctx => {
            const { subjectContainer, optionContainer } = ctx;
            if (!subjectContainer || !optionContainer) return;

            if (groups.length === 0) {
                subjectContainer.innerHTML = '<p style="color:#999; text-align:center; margin:6px 0;">No matching subjects</p>';
                optionContainer.innerHTML = '<p style="color:#999; text-align:center; margin:6px 0;">No classes to show</p>';
                return;
            }

            const selectedExists = groups.some(g => g.key === pickerState.selectedSubjectKey);
            if (!selectedExists) {
                pickerState.selectedSubjectKey = groups[0].key;
            }

            const selectedGroup = groups.find(g => g.key === pickerState.selectedSubjectKey) || groups[0];
            const previewExists = selectedGroup.options.some(opt => opt.id === pickerState.previewOptionId);
            if (!previewExists) {
                pickerState.previewOptionId = selectedGroup.options[0]?.id || '';
            }

            let subjectHtml = '';
            groups.forEach(group => {
                const checkedCount = group.options.filter(opt => opt.checked).length;
                const activeClass = group.key === selectedGroup.key ? 'subject-item active' : 'subject-item';
                const selectedClass = checkedCount > 0 ? ' has-selected' : '';
                subjectHtml += `
                    <div class="${activeClass}${selectedClass}" data-subject-key="${group.key}">
                        <div class="subject-item-code" style="color:${group.color};">${group.code}</div>
                        <div class="subject-item-name">${group.name}</div>
                        <div class="subject-item-meta">${group.options.length} options | ${checkedCount} selected</div>
                    </div>
                `;
            });
            subjectContainer.innerHTML = subjectHtml;

            let optionHtml = '<div class="picker-list">';
            selectedGroup.options.forEach(opt => {
                const itemClass = opt.checked ? 'picker-item checked' : 'picker-item';
                const toggleClass = opt.checked ? 'picker-toggle checked' : 'picker-toggle';
                const toggleLabel = opt.disabled ? 'Locked' : (opt.checked ? 'Selected' : 'Select');
                const timeText = opt.times.length ? opt.times.join(' + ') : 'No schedule parsed';
                const optionIdLabel = (opt.element?.value || opt.id || '').toString();
                const previewOutline = opt.id === pickerState.previewOptionId ? 'border: 2px solid #4facfe;' : '';

                optionHtml += `
                    <div class="${itemClass}" data-picker-id="${opt.id}" style="${previewOutline}">
                        <div class="picker-item-main" data-picker-jump="${opt.id}">
                            <div>
                                <span class="picker-item-code" style="color:${opt.color};">${opt.code}</span>
                                <span class="picker-item-option-id">${optionIdLabel}</span>
                            </div>
                            <div class="picker-item-name">${opt.name}</div>
                            <div class="picker-item-time">${timeText}</div>
                        </div>
                        <button class="${toggleClass}" data-picker-toggle="${opt.id}" ${opt.disabled ? 'disabled' : ''}>${toggleLabel}</button>
                    </div>
                `;
            });
            optionHtml += '</div>';
            optionContainer.innerHTML = optionHtml;

            subjectContainer.querySelectorAll('[data-subject-key]').forEach(el => {
                el.addEventListener('click', () => {
                    pickerState.selectedSubjectKey = el.getAttribute('data-subject-key') || '';
                    const refreshed = getAllClassOptions();
                    const nextGroup = getSubjectGroups(refreshed).find(g => g.key === pickerState.selectedSubjectKey);
                    pickerState.previewOptionId = nextGroup?.options?.[0]?.id || '';
                    updateVisualization();
                });
            });

            optionContainer.querySelectorAll('[data-picker-toggle]').forEach(btn => {
                btn.addEventListener('click', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    const id = btn.getAttribute('data-picker-toggle') || '';
                    pickerState.previewOptionId = id;
                    toggleClassOption(id);
                });
            });

            optionContainer.querySelectorAll('[data-picker-jump]').forEach(el => {
                el.addEventListener('click', () => {
                    const id = el.getAttribute('data-picker-jump');
                    const target = selectedGroup.options.find(opt => opt.id === id);
                    if (target) {
                        pickerState.previewOptionId = target.id;
                        jumpToClass(target);
                        updateVisualization();
                    }
                });
            });
        });
    }

    function setupListeners() {
        const widget = document.getElementById('class-visualizer-widget');
        if (!widget) {
            console.error('Widget not found!');
            return;
        }

        console.log('Setting up listeners for widget:', widget);

        widget.querySelector('.visualizer-close').addEventListener('click', () => {
            widget.style.display = 'none';
        });

        const refreshBtn = widget.querySelector('#refresh-btn');
        console.log('Refresh button found:', refreshBtn);

        if (refreshBtn) {
            refreshBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('🔄 REFRESH BUTTON CLICKED!!!');
                updateVisualization();
            });
            console.log('Refresh button listener attached');
        } else {
            console.error('Refresh button NOT FOUND');
        }

        widget.querySelectorAll('.visualizer-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const viewName = tab.dataset.view;

                widget.querySelectorAll('.visualizer-tab').forEach(t => t.classList.remove('active'));
                widget.querySelectorAll('.view-tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');

                const targetContent = widget.querySelector(`.view-tab-content[data-view="${viewName}"]`);
                if (targetContent) {
                    targetContent.classList.add('active');
                } else {
                    console.warn(`Content container for view "${viewName}" not found`);
                }
            });
        });

        const pickerSearchInput = widget.querySelector('#picker-subject-search');
        if (pickerSearchInput) {
            pickerSearchInput.addEventListener('input', () => {
                pickerState.search = pickerSearchInput.value || '';
                const scheduleSearch = widget.querySelector('#schedule-subject-search');
                if (scheduleSearch && scheduleSearch.value !== pickerState.search) {
                    scheduleSearch.value = pickerState.search;
                }
                updatePickerView(getAllClassOptions());
            });
        }

        const scheduleSearchInput = widget.querySelector('#schedule-subject-search');
        if (scheduleSearchInput) {
            scheduleSearchInput.addEventListener('input', () => {
                pickerState.search = scheduleSearchInput.value || '';
                const pickerSearch = widget.querySelector('#picker-subject-search');
                if (pickerSearch && pickerSearch.value !== pickerState.search) {
                    pickerSearch.value = pickerState.search;
                }
                updatePickerView(getAllClassOptions());
            });
        }

        let isDragging = false;
        let dragOffset = { x: 0, y: 0 };

        widget.querySelector('.visualizer-header').addEventListener('mousedown', (e) => {
            isDragging = true;
            dragOffset.x = e.clientX - widget.offsetLeft;
            dragOffset.y = e.clientY - widget.offsetTop;
        });

        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                widget.style.left = (e.clientX - dragOffset.x) + 'px';
                widget.style.top = (e.clientY - dragOffset.y) + 'px';
                widget.style.right = 'auto';
                widget.style.bottom = 'auto';
            }
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });

        document.addEventListener('change', (e) => {
            if (e.target.type === 'checkbox' && e.target.name.includes('chkChon')) {
                console.log('Checkbox changed:', e.target.name);
                setTimeout(updateVisualization, 100);
            }
        });

        document.addEventListener('click', (e) => {
            if (e.target.type === 'checkbox' && e.target.name.includes('chkChon')) {
                console.log('Checkbox clicked:', e.target.name);
                setTimeout(updateVisualization, 100);
            }
        });

        const checkrows = document.querySelectorAll('tr.checkrow');
        checkrows.forEach(row => {
            const observer = new MutationObserver(() => {
                console.log('Row changed:', row);
                setTimeout(updateVisualization, 100);
            });
            observer.observe(row, { attributes: true, subtree: true });
        });

        let lastClassCount = 0;
        setInterval(() => {
            const classes = getSelectedClasses();
            if (classes.length !== lastClassCount) {
                console.log('📊 Class count changed:', lastClassCount, '→', classes.length);
                lastClassCount = classes.length;
                updateVisualization();
            }
        }, 800);

        setTimeout(updateVisualization, 500);
    }

    function init() {
        console.log(' TDTU Visualizer starting...');

        window.tdtuDebug = {
            refresh: () => { console.log('Calling updateVisualization...'); updateVisualization(); },
            checkSchedules: () => {
                const allClasses = getSelectedClasses();
                const uniqueClasses = getUniqueClasses(allClasses);
                console.log('All class instances:', allClasses);
                console.log('Unique classes:', uniqueClasses);
                uniqueClasses.forEach(cls => {
                    console.log(`${cls.code}: ${cls.times.join(' + ')} (Color: ${cls.color})`);
                });
            },
            gridDebug: () => {
                const allClasses = getSelectedClasses();
                if (allClasses.length === 0) {
                    console.log('No classes found');
                    return;
                }
                console.log('Classes found:', allClasses.length);
                allClasses.forEach((cls, i) => {
                    const parsed = parseSchedule(cls.time);
                    console.log(`  [${i}] ${cls.code} - time="${cls.time}" -> parsed:`, parsed);
                });
            }
        };
        console.log('Available debug commands: tdtuDebug.refresh(), tdtuDebug.checkSchedules(), tdtuDebug.gridDebug()');

        addStyles();
        const widget = createVisualizer();
        document.body.appendChild(widget);
        setupListeners();
        updateVisualization();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
