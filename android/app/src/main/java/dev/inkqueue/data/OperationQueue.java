package dev.inkqueue.data;

import org.json.JSONException;

public class OperationQueue {
    private final TaskRepository repository;

    public OperationQueue(TaskRepository repository) {
        this.repository = repository;
    }

    public void complete(Task task, String completedAt) throws JSONException {
        repository.markDoneAndQueueOperation(task.id, completedAt, PendingOperation.complete(task.id, completedAt));
    }

    public void postpone(Task task, String targetDate, String postponeTarget) throws JSONException {
        repository.postponeAndQueueOperation(task.id, targetDate, PendingOperation.postpone(task.id, targetDate, task.dueTime, postponeTarget));
    }
}
