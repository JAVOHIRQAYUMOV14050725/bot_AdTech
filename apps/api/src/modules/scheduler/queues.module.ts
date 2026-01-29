import { Module } from '@nestjs/common';
import { SchedulerQueuesService } from './queues.service';

@Module({
    providers: [SchedulerQueuesService],
    exports: [SchedulerQueuesService],
})
export class SchedulerQueuesModule { }
