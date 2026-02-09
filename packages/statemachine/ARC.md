I want the follow ing structure for state machine.

Trigger -> 
    - inputs:
        machine: issue | discussion (controls which machine to use)
    - resolve context
        - parent resource (issue or discussion)
        - current state (use parseResource (inputs.machine) to get back the issue/discussion
        - determine current state from context
    - run (run the state machine)
        - get back set of actions to perform
        - estimate expected next state
        - actions is an array of phases Phase[], where each phase represents a configuration of actions that can run concurrently ([[1,2],[3],[4,5,6]])
    - act
        - loop over each phase, and execute each action
        - collect and report any errors
    - verify
        - verify if the new current state
            - is different than the previous (initial) state
            - is what we expected

This is different than the current state machine in a few key ways.
1. only input is machine. We only tell the state machine what machine to use
2. distinct machines (we separate issue/discussion) machines at the code level. different machines trigger different actions/states etc. they can share core architectural features.
3. we do not need multiple github jobs. entire state machine runs in a single action, on a single job. concurrency/cancellation all happens internally via querying running state machine and waiting or cancelling.
4. Entire state machine runs through a more structured path ( a framework) where each state should reutnr a