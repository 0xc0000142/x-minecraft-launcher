import { InstanceState } from './InstanceService'
import { JavaState } from './JavaService'
import { ServiceKey, State, StatefulService } from './Service'

export interface InstanceJavaState extends State {
}
export class InstanceJavaState {
  constructor(private instance: InstanceState, private java: JavaState) { }
  /**
   * The selected instance mapped local java.
   * If there is no matching java for current instance, it will return the `DEFAULT_JAVA`
   * which contains the `majorVersion` equal to 0
   */
  get instanceJava() {
    const javaPath = this.instance.instance.java
    if (javaPath && javaPath !== '') {
      return this.java.all.find(j => j.path === javaPath) || {
        path: javaPath,
        version: '',
        majorVersion: 0,
        valid: false,
      }
    }
    return this.java.defaultJava
  }
}

/**
 * Provide the service to host the java info of the instance
 */
export interface InstanceJavaService extends StatefulService<InstanceJavaState> {
  diagnoseJava(): Promise<void>
}

export const InstanceJavaServiceKey: ServiceKey<InstanceJavaService> = 'InstanceJavaService'
