import { Injectable } from '@nestjs/common';
import * as moment from 'moment';
import { Message, Login } from '@book-appointmnet/api-interfaces';
import { LoginDto } from '../dto/login.dto';
import { RedisCacheService } from '../utils/redis.service';
import { BookSlotDto } from '../dto/bookSlot.dto';
import { SchemaFieldTypes } from 'redis'; 
import { GetAppointmentDto } from '../dto/getAppointment.dto';
@Injectable()
export class AppService {
  public client;
  public redisCacheObject = new RedisCacheService();

  constructor() {
    this.client = this.redisCacheObject.getClient();
    this.redisCacheObject.generateIndex();
  }

  getData(): Message {
    return { message: 'Welcome to api!' };
  }

  async login(loginDto: LoginDto): Promise<Login> {
    try {
      if (loginDto.email && loginDto.password) {
        const token = Math.ceil((Math.random() * new Date().getTime())).toString();

        const key = `${token}`;

        const redisData = await this.client.json.get(key);

        const response: Login = {
          email: loginDto.email,
          token: redisData?.token ? redisData?.token : token,
          name: loginDto.email.split('@')[0],
          role: loginDto.email.indexOf('user') >= 0 ? 'user' : 'admin'
        };

        await this.client.json.set(key, '.', response);

        return response;
      } else {
        throw new Error('Invalid Credentials');
      }
    } catch (err) {
      console.log(err)
      throw err;
    }
  }

  async generateSlots(date: string) {
    const duration = 20;
    const startDateFormat = `${date}T10:00:00`;
    const endDateFormat = `${date}T22:00:00`;
    let currentDate = startDateFormat;
    const slots = [];

    // get all booked slots
    let bookedSlots = [];
    const bookedSlotsKeys = await this.client.keys('booked:slots:*');
    if (bookedSlotsKeys?.length) {
        let bookedSlotsDataInRedis = await this.client.json.mGet(bookedSlotsKeys, '$');
        bookedSlotsDataInRedis = [].concat(...bookedSlotsDataInRedis);
        for (let slots of bookedSlotsDataInRedis) {
          bookedSlots = [...bookedSlots, ...slots.slots];
        }
    }

    while(new Date(currentDate) < new Date(endDateFormat)) {
      const startTime = moment(currentDate).format('YYYY-MM-DDTHH:mm:ss');
      const endTime = moment(currentDate).add(duration, 'minutes').format('YYYY-MM-DDTHH:mm:ss');

      let isBooked = 0;
      if (bookedSlots?.length) {
        const foundSlot = bookedSlots.find(obj => obj.startTime === startTime && obj.endTime === endTime);
        if (foundSlot) {
          isBooked = 1;
        }  
      }

      slots.push({
        startTime,
        endTime,
        isBooked
      });

      currentDate = endTime;
    }
    return slots
  }

  async bookSlot(bookSlotDto: BookSlotDto, userData: Login) {
    // check that incoming is booked or not
    try {
      const date = moment(bookSlotDto.startTime).format('YYYY-MM-DD').replace(/\-/g, '');
      const key = `booked:slots:${userData.email}:${date}`;
  
      const data = await this.client.json.get(key);
      // console.log("data ", data)

      if (data?.slots) {
        const bookedSlot = data.slots.find(obj => obj.startTime === bookSlotDto.startTime && obj.endTime === bookSlotDto.endTime);
  
        if (bookedSlot) {
          throw new Error('This slot is already booked. Please choose another one.');
        }
      }

      const obj = {
        "name": userData.name,
        "email": userData.email,
        "date": date,
        "slots" : [{
          "startTime": bookSlotDto.startTime,
          "endTime": bookSlotDto.endTime,
          "category": bookSlotDto.category
        }]
      }
  
      if (!data) {
        await this.client.json.set(key, '$', obj);
      } else {
        await this.client.json.arrAppend(key, '.slots', {
          "startTime": bookSlotDto.startTime,
          "endTime": bookSlotDto.endTime,
          "category": bookSlotDto.category
        });
      }
  
      return true;
      
    } catch (err) {
      console.log("ERRR", err);
      throw err;
    }
  }

  async getAppointments(appointmentDto: GetAppointmentDto) {
    try {
      const dateSlug = moment(appointmentDto.date).format('YYYY-MM-DD').replace(/\-/g, '');
  
      let serchString = `@date:(${dateSlug})`;

      if (appointmentDto.name) {
        serchString += `,@name:(${appointmentDto.name}),@email:(${appointmentDto.name})`
      }

      const bookSlots = await this.client.ft.search('idx:slots', `${serchString}`);
      const response = [];

      if (bookSlots?.documents?.length) {
        for (let obj of bookSlots?.documents) {
          response.push(obj.value);
        }
        return response;
      } else {
        return [];
      }
    } catch (err) {
      throw err;
    }
  }
}
