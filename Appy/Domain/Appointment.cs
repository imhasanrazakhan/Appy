﻿using Appy.DTOs;
using Microsoft.EntityFrameworkCore;

#nullable disable

namespace Appy.Domain
{
    public class Appointment
    {
        public int Id { get; set; }

        public int FacilityId { get; set; }
        public Facility Facility { get; set; }

        public DateOnly Date { get; set; }
        public TimeOnly Time { get; set; }
        public TimeSpan Duration { get; set; }

        public int ServiceId { get; set; }
        public Service Service { get; set; }

        public int ClientId { get; set; }
        public Client Client { get; set; }

        public AppointmentDTO GetDTO()
        {
            return new AppointmentDTO()
            {
                Id = Id,
                Date = Date,
                Time = Time,
                Duration = Duration,
                Service = Service.GetDTO(),
                Client = Client.GetDTO()
            };
        }

        public static void OnModelCreating(ModelBuilder modelBuilder)
        {
            modelBuilder
                .Entity<Appointment>()
                .HasOne(o => o.Service)
                .WithMany()
                .OnDelete(DeleteBehavior.NoAction);

            modelBuilder
                .Entity<Appointment>()
                .HasOne(o => o.Client)
                .WithMany()
                .OnDelete(DeleteBehavior.NoAction);
        }
    }
}
