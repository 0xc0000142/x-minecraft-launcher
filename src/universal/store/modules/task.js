import { v4 } from 'uuid';
import { ipcMain } from 'electron';
import base from './task.base';
import { requireString } from '../../utils/object';

class TaskWatcher {
    constructor() {
        this.listener = -1;

        this.adds = [];
        this.childs = [];
        this.updates = {};
        this.statuses = [];
    }

    add(id, node) {
        this.adds.push({
            id,
            node,
        });
    }

    update(uuid, update) {
        const last = this.updates[uuid];
        if (last) {
            this.updates[uuid] = {
                progress: last.progress || update.progress,
                total: last.total || update.total,
                message: last.message || update.message,
            };
        } else {
            this.updates[uuid] = update;
        }
    }

    child(id, node) {
        this.childs.push({
            id,
            node,
        });
    }

    status(uuid, status) {
        this.statuses.push({ id: uuid, status });
    }

    ensureListener(context) {
        if (this.listener === -1) {
            this.listener = setInterval(() => {
                if (this.adds.length !== 0 || this.childs.length !== 0 || Object.keys(this.updates).length !== 0 || this.statuses.length !== 0) {
                    context.commit('$update', {
                        adds: this.adds,
                        childs: this.childs,
                        updates: this.updates,
                        statuses: this.statuses,
                    });

                    this.adds = [];
                    this.childs = [];
                    this.updates = {};
                    this.statuses = [];
                }
            }, 500);
        }
    }
}

const taskWatcher = new TaskWatcher();

const nameToTask = {};
const idToTask = {};

/**
 * @type {import('./task').TaskModule}
 */
const mod = {
    ...base,
    actions: {
        spawn(context, name) {
            requireString(name);
            const id = v4();
            /**
            * @type {import('treelike-task').TaskNode}
            */
            const node = {
                _internalId: id,
                name,
                total: -1,
                progress: -1,
                status: 'running',
                path: name,
                tasks: [],
                errors: [],
                message: '',
            };
            context.commit('hook', { task: node, id });
            return id;
        },
        update(context, payload) {
            requireString(payload.id);
            taskWatcher.update(payload.id, payload);
        },
        finish(context, payload) {
            requireString(payload.id);
            taskWatcher.status(payload.id, 'successed');
        },
        cancel(context, uuid) {
            const task = idToTask[uuid];
            if (task) { task.cancel(); }
        },
        wait(context, uuid) {
            const task = idToTask[uuid];
            if (!task) return Promise.resolve();
            return task.promise;
        },
        execute(context, task) {
            const key = JSON.stringify({ name: task.root.name, arguments: task.root.arguments });

            if (nameToTask[key]) {
                return nameToTask[key].id;
            }

            console.log(`Task Execute: ${task.root.name}`);

            taskWatcher.ensureListener(context);
            const uuid = v4();
            let _internalId = 0;
            task.onChild((parent, child) => {
                child._internalId = `${uuid}-${_internalId}`;
                _internalId += 1;

                child.time = new Date().toLocaleTimeString();
                taskWatcher.child(parent._internalId, child);
            });
            task.onUpdate((update, node) => {
                taskWatcher.update(node._internalId, update);
            });
            task.onFinish((result, node) => {
                console.error(`Task Finish: ${node.path}`);
                if (task.root === node) {
                    ipcMain.emit('task-successed', node._internalId);
                    delete nameToTask[key];
                }

                taskWatcher.status(node._internalId, 'successed');
            });
            task.onError((error, node) => {
                console.error(`Task Error: ${node.path}`);
                console.error(error);

                if (task.root === node) {
                    ipcMain.emit('task-failed', node._internalId);
                    delete nameToTask[key];
                }

                taskWatcher.status(node._internalId, 'failed');
            });
            task.root.time = new Date().toLocaleTimeString();
            task.root._internalId = uuid;
            task.id = uuid;

            context.commit('hook', { id: uuid, task: task.root });

            const promise = task.execute();

            task.promise = promise;

            nameToTask[key] = task;
            idToTask[uuid] = task;

            return uuid;
        },
    },
};

export default mod;
