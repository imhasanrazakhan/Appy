import { Appointment, AppointmentDTO } from "./appointment";
import { WorkingHour, WorkingHourDTO } from "./working-hours";
import moment from "moment/moment";
import { Moment } from "moment";


export class CalendarDayDTO {
    public date?: string;
    public appointments?: AppointmentDTO[];
    public workingHours?: WorkingHourDTO[];
}

export class CalendarDay {
    public date?: Moment;
    public appointments?: Appointment[];
    public workingHours?: WorkingHour[];

    constructor(dto: CalendarDayDTO = new CalendarDayDTO()) {
        this.date = dto.date ? moment(dto.date) : undefined;
        this.appointments = dto.appointments ? dto.appointments.map(a => new Appointment(a)) : undefined;
        this.workingHours = dto.workingHours ? dto.workingHours.map(w => new WorkingHour(w)) : undefined;
    }
}