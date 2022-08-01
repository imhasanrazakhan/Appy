import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import * as moment from 'moment';
import { Subscription } from 'rxjs';
import { Appointment } from 'src/app/models/appointment';
import { CalendarDay } from 'src/app/models/calendar-day';
import { FreeTime } from 'src/app/models/free-time';
import { CalendarDayService } from 'src/app/services/calendar-day.service';
import { Data, DateSmartCaching } from 'src/app/utils/smart-caching';
import { Tween } from 'src/app/utils/tween';

@Component({
  selector: 'app-appointments-scroller',
  templateUrl: './appointments-scroller.component.html',
  styleUrls: ['./appointments-scroller.component.scss']
})
export class AppointmentsScrollerComponent implements OnInit, OnDestroy {
  private _daysToShow: number = 1;
  @Input() set daysToShow(value: number) {
    if (this._daysToShow == value)
      return;

    this._daysToShow = value;
    this.smartCaching.showCount = this._daysToShow;
    this.load();
  }
  get daysToShow(): number {
    return this._daysToShow;
  }

  private _date: moment.Moment = moment();
  @Input() set date(value: moment.Moment) {
    if (this.date.isSame(value, "date"))
      return;

    this._date = value;
    this.load();

    this.dateChange.emit(value);
  }
  get date(): moment.Moment {
    return this._date;
  }
  @Output() dateChange: EventEmitter<moment.Moment> = new EventEmitter();

  @Input() showDateControls: boolean = false;

  private _shadowAppointments: Appointment[] = [];
  @Input() set shadowAppointments(value: Appointment[]) {
    if (this._shadowAppointments == value)
      return;

    this._shadowAppointments = value;
    this.refreshFromToTime();
  }
  get shadowAppointments(): Appointment[] {
    return this._shadowAppointments;
  }

  @Input() freeTimes: FreeTime[] | null = null;

  public smartCaching: DateSmartCaching<CalendarDay> = new DateSmartCaching(d => this.calendarDayService.getAll(d), this.daysToShow);

  public timeFrom: moment.Moment = moment({ hours: 8 });
  public timeTo: moment.Moment = moment({ hours: 20 });

  private timeFromTween: Tween = new Tween(() => this.timeFrom.unix(), v => this.timeFrom = moment.unix(v));
  private timeToTween: Tween = new Tween(() => this.timeTo.unix(), v => this.timeTo = moment.unix(v));

  private subs: Subscription[] = [];

  constructor(
    private calendarDayService: CalendarDayService,
  ) {
  }

  ngOnInit(): void {
    this.subs.push(this.smartCaching.onDataLoaded.subscribe(d => {
      this.refreshFromToTime();
    }));

    this.load();
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());

    this.smartCaching.dispose();
  }

  load() {
    this.smartCaching.load(this.date);
    this.refreshFromToTime();
  }

  refreshFromToTime() {
    let timeFrom: moment.Moment | null = null;
    let timeTo: moment.Moment | null = null;

    for (let daysData of this.smartCaching.data.filter(d => d.show)) {
      if (daysData.data == null)
        continue;

      if (daysData.data.workingHours) {
        for (let wh of daysData.data.workingHours) {
          if (wh.timeFrom == null || wh.timeTo == null)
            continue;

          if (timeFrom == null || wh.timeFrom.isBefore(timeFrom))
            timeFrom = wh.timeFrom.clone();

          if (timeTo == null || wh.timeTo.isAfter(timeTo))
            timeTo = wh.timeTo.clone();
        }

      }

      if (daysData.data.appointments) {
        for (let app of daysData.data.appointments) {
          if (app.time == null || app.duration == null)
            continue;

          if (timeFrom == null || app.time.isBefore(timeFrom))
            timeFrom = app.time.clone();

          if (timeTo == null || app.time?.clone().add(app.duration).isAfter(timeTo))
            timeTo = app.time.clone().add(app.duration);
        }
      }
    }

    for (let app of this.shadowAppointments) {
      if (app.time == null || app.duration == null)
        continue;

      if (timeFrom == null || app.time.isBefore(timeFrom))
        timeFrom = app.time.clone();

      if (timeTo == null || app.time?.clone().add(app.duration).isAfter(timeTo))
        timeTo = app.time.clone().add(app.duration);
    }

    let timeFromStamp = (timeFrom ?? moment({ hours: 8 })).unix();
    let timeToStamp = (timeTo ?? moment({ hours: 14 })).unix();

    let duration = 300;

    this.timeFromTween.tweenTo(timeFromStamp, duration);
    this.timeToTween.tweenTo(timeToStamp, duration);
  }

  getHeight(): string {
    return (this.timeTo.diff(this.timeFrom, "hours", true) / 8) * 100 + "vh";
  }

  onlyVisibleDataFilter(data: Data<moment.Moment, CalendarDay>): boolean {
    return data.show == true;
  }
}