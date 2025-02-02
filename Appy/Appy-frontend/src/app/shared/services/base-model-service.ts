import { HttpClient, HttpContext, HttpErrorResponse } from "@angular/common/http";
import { Injector } from "@angular/core";
import { catchError, map, Observable, Observer, Subscriber, Subscription, throwError } from "rxjs";
import { appConfig } from "../../app.config";
import { BaseModel } from "../../models/base-model";
import { isEqual, reduceRight } from "lodash-es";
import { IGNORE_NOT_FOUND } from "./errors/error-interceptor.service";
import { getInsertIndex, isSorted } from "src/app/utils/array-utils";

export class BaseModelService<T extends BaseModel> implements IEntityTracker<T> {

    protected httpClient: HttpClient;

    private datasources: IDatasource<T>[] = [];

    constructor(
        protected injector: Injector,
        protected controllerName: string,
        private typeFactory: (new (dto?: any) => T)) {

        this.httpClient = this.injector.get(HttpClient);
    }

    private createListDatasourceInternal(sub: Subscriber<T[]>, datasourceFilterPredicate?: (entity: T) => boolean): Datasource<T> {
        let dc = new ListDatasource<T>([], sub, datasourceFilterPredicate);
        this.datasources.push(dc);

        return dc;
    }

    private createSingleDatasourceInternal(sub: Subscriber<T>, id: any) {
        let dc = new SingleDatasource<T>([], sub, e => e.getId() == id);
        this.datasources.push(dc);

        return dc;
    }

    private createPageableDatasourceInternal(
        loadFunction: (dir: "forwards" | "backwards", skip: number, take: number) => Observable<T[]>,
        sortPredicate: (a: T, b: T) => number,
        filterPredicate?: (e: T) => boolean): PageableListDatasource<T> {

        let dc = new PageableListDatasource<T>(loadFunction, sortPredicate, filterPredicate);
        this.datasources.push(dc);

        return dc;
    }

    public createDatasource(initialData: T[], datasourceFilterPredicate?: (entity: T) => boolean): Observable<T[]> {
        return new Observable<T[]>(s => {
            let ds = this.createListDatasourceInternal(s, datasourceFilterPredicate);
            ds.add(initialData);
        });
    }

    public getAll(): Observable<T[]> {
        return this.getAllAdvanced(null);
    }

    public getAllAdvanced(params: any, datasourceFilterPredicate?: (entity: T) => boolean): Observable<T[]> {
        return new Observable<T[]>(s => {
            let datasource = this.createListDatasourceInternal(s, datasourceFilterPredicate);

            this.httpClient.get<any[]>(`${appConfig.apiUrl}${this.controllerName}/getAll`, {
                params: params
            }).subscribe({
                next: (r: any[]) => datasource.add(r.map(o => new this.typeFactory(o))),
                error: (e: any) => s.error(e)
            });
        });
    }

    public getListAdvanced(params: any, sortPredicate: (a: T, b: T) => number, filterPredicate?: (e: T) => boolean): PageableListDatasource<T> {
        let loadFunction = (dir: "forwards" | "backwards", skip: number, take: number): Observable<T[]> => {
            let p = {
                ...params,
                direction: dir,
                skip: skip,
                take: take
            };

            return this.httpClient.get<T[]>(`${appConfig.apiUrl}${this.controllerName}/getList`, {
                params: p
            }).pipe(map(r => r.map(o => new this.typeFactory(o))));
        };

        let datasource = this.createPageableDatasourceInternal(loadFunction, sortPredicate, filterPredicate);
        datasource.load();

        return datasource;
    }

    public save(entity: T, params?: any): Observable<T> {
        return this.httpClient.put<any>(`${appConfig.apiUrl}${this.controllerName}/edit/${entity.getId()}`, entity.getDTO(), { params })
            .pipe(
                map(s => {
                    let newEntity = new this.typeFactory(s);

                    this.notifyUpdated(newEntity);

                    return newEntity;
                }),
                catchError(e => {
                    if (e?.error?.errors)
                        entity.applyServerValidationErrors(e.error.errors);

                    return throwError(() => e);
                }));
    }

    public addNew(entity: T, params?: any): Observable<T> {
        return this.httpClient.post<any>(`${appConfig.apiUrl}${this.controllerName}/addNew`, entity.getDTO(), { params })
            .pipe(
                map(s => {
                    let newEntity = new this.typeFactory(s);

                    this.notifyAdded(newEntity);

                    return newEntity;
                }),
                catchError(e => {
                    if (e?.error?.errors)
                        entity.applyServerValidationErrors(e.error.errors);

                    return throwError(() => e);
                }));
    }

    public delete(id: any): Observable<void> {
        return this.httpClient.delete<void>(`${appConfig.apiUrl}${this.controllerName}/delete/${id}`)
            .pipe(map(() => {
                this.notifyDeleted(id);
            }));
    }

    public get(id: any): Observable<T> {
        return this.httpClient.get<any>(`${appConfig.apiUrl}${this.controllerName}/get/${id}`)
            .pipe(map(s => new this.typeFactory(s)));
    }

    public getWithDatasource(id: any): Observable<T | undefined> {
        return new Observable<T>(s => {
            let datasource = this.createSingleDatasourceInternal(s, id);

            let context = new HttpContext().set(IGNORE_NOT_FOUND, true);
            this.httpClient.get<any>(`${appConfig.apiUrl}${this.controllerName}/get/${id}`, { context })
                .pipe(map(s => new this.typeFactory(s)))
                .subscribe({
                    next: (r: T) => datasource.add([r]),
                    error: (e: any) => {
                        if (e instanceof HttpErrorResponse && e.status == 404)
                            datasource.empty();
                        else
                            s.error(e);
                    }
                });
        });
    }

    private getDatasourceContexts(): IDatasource<T>[] {
        let contexts = this.datasources.filter(c => !c.isUnsubscribed());

        this.datasources = contexts;
        return contexts;
    }

    public notifyAdded(entity: T): void {
        for (let c of this.getDatasourceContexts())
            c.add([entity]);
    }

    public notifyDeleted(id: any): void {
        for (let c of this.getDatasourceContexts())
            c.delete(id);
    }

    public notifyUpdated(entity: T): void {
        for (let c of this.getDatasourceContexts())
            c.update(entity);
    }
}

export interface IEntityTracker<T extends BaseModel> {
    notifyAdded(entity: T): void;
    notifyDeleted(id: any): void;
    notifyUpdated(entity: T): void;
}

export interface IDatasource<T extends BaseModel> {
    add(entities: T[]): void;
    update(entity: T): void;
    delete(id: any): void;

    isUnsubscribed(): boolean;
}

abstract class Datasource<T extends BaseModel> implements IDatasource<T> {
    data: T[];
    filterPredicate?: (entity: T) => boolean;
    isLoaded: boolean = false;

    constructor(data: T[], filterPredicate?: (entity: T) => boolean) {
        this.data = data;
        this.filterPredicate = filterPredicate;
    }

    add(entities: T[]) {
        if (!this.isLoaded && entities.length == 0) {
            this.notifySubscriber();
            this.isLoaded = true;
            return;
        }

        this.isLoaded = true;

        let newEntities: T[] = [];
        for (let newItem of entities) {
            let oldEntity = this.data.find(o => isEqual(o.getId(), newItem.getId()));
            if (oldEntity == null) {
                if (this.filterPredicate && !this.filterPredicate(newItem))
                    continue;

                newEntities.push(newItem);
            }
            else
                this.update(newItem);
        }

        this.data.splice(0, 0, ...newEntities);

        if (newEntities.length > 0)
            this.notifySubscriber();
    }

    update(entity: T) {
        if (!this.isLoaded)
            return;

        let oldEntity = this.data.find(o => isEqual(o.getId(), entity.getId()));

        if (oldEntity == null) {
            this.add([entity]);
            return;
        }

        updateEntity(oldEntity, entity);

        if (this.filterPredicate && !this.filterPredicate(oldEntity))
            this.data.splice(this.data.indexOf(oldEntity), 1);

        this.notifySubscriber();
    }

    delete(id: any) {
        if (!this.isLoaded)
            return;

        let index = this.data.findIndex(o => isEqual(o.getId(), id));

        if (index == -1)
            return;

        this.data.splice(index, 1);

        this.notifySubscriber();
    }

    empty() {
        this.data.splice(0, this.data.length);

        this.notifySubscriber();
    }

    abstract notifySubscriber(): void;
    abstract isUnsubscribed(): boolean;
}

class ListDatasource<T extends BaseModel> extends Datasource<T> {
    subscriber: Subscriber<T[]>;

    constructor(data: T[], sub: Subscriber<T[]>, filterPredicate?: (entity: T) => boolean) {
        super(data, filterPredicate);

        this.subscriber = sub;
    }

    notifySubscriber(): void {
        this.subscriber.next([...this.data]);
    }

    isUnsubscribed(): boolean {
        return this.subscriber.closed;
    }
}

class SingleDatasource<T extends BaseModel> extends Datasource<T> {
    subscriber: Subscriber<T>;

    constructor(data: T[], sub: Subscriber<T>, filterPredicate?: (entity: T) => boolean) {
        super(data, filterPredicate);

        this.subscriber = sub;
    }

    notifySubscriber(): void {
        if (this.data.length == 0)
            this.subscriber.next(undefined);
        else if (this.data.length == 1)
            this.subscriber.next(this.data[0]);
        else
            throw new Error("SingleDatasource received more than one element! You have duplicate Ids or wrongly implemented getId() method");
    }

    isUnsubscribed(): boolean {
        return this.subscriber.closed;
    }
}

export class PageableListDatasource<T extends BaseModel> implements IDatasource<T> {
    private itemsPerPage = 20;

    private data: T[] = [];

    private reachedEndBackwards = false;
    private reachedEndForwards = false;

    private forwardsSkip = 0;
    private backwardsSkip = 0;

    private nextPageSub: Subscription | null = null;
    private previousPageSub: Subscription | null = null;

    private isFirstLoading: boolean = false;

    private subscribers: Subscriber<T[]>[] = [];

    constructor(
        private loadFunction: (dir: "forwards" | "backwards", skip: number, take: number) => Observable<T[]>,
        private sortPredicate: (a: T, b: T) => number,
        private filterPredicate?: (e: T) => boolean) {

    }

    add(entities: T[], forceNotifySubscribers: boolean = false): void {
        if (!isSorted(entities, this.sortPredicate))
            throw new Error("Received entities are not correctly sorted. Check if backend sort matches frontends sort!");

        let changed = false;

        for (let newEntity of entities) {
            let oldEntity = this.data.find(o => isEqual(o.getId(), newEntity.getId()));
            if (oldEntity == null)
                changed = this.tryAddSingle(newEntity) || changed;
            else
                changed = this.tryUpdate(newEntity) || changed;
        }

        if (forceNotifySubscribers || changed)
            this.notifySubscribers();
    }

    private tryAddSingle(entity: T): boolean {
        if (this.filterPredicate && !this.filterPredicate(entity))
            return false;

        let addIndex = getInsertIndex(this.data, entity, this.sortPredicate);

        this.data.splice(addIndex, 0, entity);

        return true;
    }

    update(entity: T): void {
        if (this.tryUpdate(entity))
            this.notifySubscribers();
    }

    private tryUpdate(entity: T): boolean {
        let oldEntity = this.data.find(o => isEqual(o.getId(), entity.getId()));

        if (oldEntity == null)
            return this.tryAddSingle(entity);

        this.data.splice(this.data.indexOf(oldEntity), 1);

        updateEntity(oldEntity, entity);

        return this.tryAddSingle(entity);
    }

    delete(id: any): void {
        let index = this.data.findIndex(o => isEqual(o.getId(), id));

        if (index == -1)
            return;

        this.data.splice(index, 1);

        this.notifySubscribers();
    }

    notifySubscribers() {
        for (let s of this.subscribers) {
            if (!s.closed)
                s.next([...this.data]);
        }
    }

    notifyErrorSubscribers(error: any) {
        for (let s of this.subscribers) {
            if (!s.closed)
                s.error(error);
        }
    }

    load(): void {
        this.data = [];
        this.loadNextPage(true);
        this.isFirstLoading = true;
    }

    loadNextPage(forceNotifySubscribers: boolean = false): void {
        if (this.isFirstLoading)
            return;

        if (this.reachedEndForwards)
            return;

        if (this.nextPageSub != null)
            return;

        this.nextPageSub = this.loadFunction("forwards", this.forwardsSkip, this.itemsPerPage).subscribe({
            next: items => {
                this.isFirstLoading = false;

                this.forwardsSkip += items.length;
                if (items.length < this.itemsPerPage)
                    this.reachedEndForwards = true;

                this.nextPageSub = null;

                this.add(items, forceNotifySubscribers);
            },
            error: e => this.notifyErrorSubscribers(e)
        });

    }

    loadPreviousPage(): void {
        if (this.isFirstLoading)
            return;

        if (this.reachedEndBackwards)
            return;

        if (this.previousPageSub != null)
            return;

        this.previousPageSub = this.loadFunction("backwards", this.backwardsSkip, this.itemsPerPage).subscribe({
            next: items => {
                this.backwardsSkip += items.length;
                if (items.length < this.itemsPerPage)
                    this.reachedEndBackwards = true;

                this.previousPageSub = null;

                this.add(items.reverse());
            },
            error: e => this.notifyErrorSubscribers(e)
        });
    }

    isUnsubscribed(): boolean {
        return this.subscribers.length == 0 || this.subscribers.every(s => s.closed);
    }

    subscribe(observer: Partial<Observer<T[]>>): Subscription {
        return new Observable<T[]>(s => {
            this.subscribers.push(s);
            
            if (!this.isFirstLoading)
                s.next([...this.data]);
        }).subscribe(observer);
    }

    dispose() {
        this.nextPageSub?.unsubscribe();
        this.previousPageSub?.unsubscribe();

        for (let s of this.subscribers) {
            s.unsubscribe();
        }
    }

    isLoadingNext() {
        return this.nextPageSub != null;
    }

    isLoadingPrevious() {
        return this.previousPageSub != null;
    }

    isReachedEndBackwards(): boolean {
        return this.reachedEndBackwards;
    }

    isReachedEndForwards(): boolean {
        return this.reachedEndForwards;
    }
}

function updateEntity<T extends BaseModel>(oldEntity: T, newEntity: T) {
    let newSymbols = Object.getOwnPropertySymbols(newEntity);
    let oldSymbols = Object.getOwnPropertySymbols(oldEntity);

    for (let newSymbol of newSymbols) {
        for (let oldSymbol of oldSymbols) {
            if (newSymbol.description == null)
                continue;

            if (newSymbol.description.startsWith("#S"))
                continue;

            if (newSymbol.description == oldSymbol.description) {
                (oldEntity as any)[oldSymbol] = (newEntity as any)[newSymbol];
            }
        }
    }
}